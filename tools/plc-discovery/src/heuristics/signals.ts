/**
 * Expansión de buffers a SEÑALES y motor de inferencia.
 *
 * Un "signal" es la unidad mínima con significado industrial: un elemento de array
 * (REAL_IN_VORAGINE[3]) o un tag escalar. El PLC maestro no nombra los elementos,
 * de modo que el significado de cada índice NO es descubrible por OPC UA: solo se
 * pueden formular HIPÓTESIS a partir del valor, su rango y su comportamiento
 * temporal. Toda hipótesis se emite marcada para validación en planta.
 */
import type { VariableReading } from '../types';
import { classifyChannel, extractSite, tankHint, type ChannelKind } from './tokens';

// Segmentos que actúan como "raíz de tags": el tag de nivel superior es el
// segmento inmediatamente posterior a cualquiera de estos en la ruta completa.
const ROOT_SEGMENTS = new Set([
  'Controller Tags',
  'StationStatusVariables',
  'Model',
  'Alarms',
  'Converters',
  'Loggers',
]);

/** Devuelve el nombre del tag de nivel superior que posee a esta variable. */
function topLevelTagName(fullBrowsePath: string, ownBrowseName: string): string {
  const parts = fullBrowsePath.split('/');
  for (let i = parts.length - 1; i >= 1; i--) {
    if (ROOT_SEGMENTS.has(parts[i - 1])) return parts[i];
  }
  return ownBrowseName;
}

export type Confidence = 'alta' | 'media' | 'baja' | 'nula';

export interface Hypothesis {
  magnitud: string;
  unidadProbable: string;
  razon: string;
}

export interface Signal {
  id: string;
  nodeId: string;
  bufferBrowseName: string;
  fullBrowsePath: string;
  arrayIndex: number | null;
  arrayLength: number | null;
  site: string | null;
  tank: string | null;
  channelKind: ChannelKind;
  direction: string;
  dataType: string;
  writableByServer: boolean;
  writableByUser: boolean;
  samples: Array<number | boolean | string | null>;
  statusCode: string;
  movement: {
    muestrasBuenas: number;
    evaluable: boolean; // ≥2 muestras numéricas buenas; si false, "changed" no es concluyente
    changed: boolean;
    min: number | null;
    max: number | null;
    monotonicNonDecreasing: boolean;
    allZero: boolean;
  };
  hypotheses: Hypothesis[];
  confidence: Confidence;
  evidence: string[];
  estado: 'CONFIRMADO' | 'REQUIERE VALIDACIÓN EN PLANTA';
  procedimientoValidacion: string | null;
}

function numericSamples(samples: unknown[]): number[] {
  return samples.filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
}

/**
 * Formula hipótesis de magnitud a partir del rango de valores y su dinámica.
 * NUNCA afirma: todas las salidas son candidatas ordenadas por plausibilidad.
 */
function hypothesize(
  values: number[],
  isInteger: boolean,
  monotonic: boolean,
  channelKind: ChannelKind,
  isTank: boolean,
): Hypothesis[] {
  const h: Hypothesis[] = [];
  if (values.length === 0) return h;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const allInt = values.every((v) => Number.isInteger(v));

  if (min === 0 && max === 0) {
    h.push({
      magnitud: 'sin dato',
      unidadProbable: '—',
      razon: 'todas las muestras en cero: índice sin uso, sitio sin comunicación o señal en reposo',
    });
    return h;
  }

  if (monotonic && max > min) {
    h.push({
      magnitud: 'totalizador acumulado',
      unidadProbable: 'm³ (o L)',
      razon: `crecimiento monótono entre muestras (${min} → ${max}) característico de un acumulador`,
    });
  }

  if (allInt && min >= 0 && max <= 1) {
    h.push({
      magnitud: 'estado discreto',
      unidadProbable: 'booleano',
      razon: 'valores confinados a {0,1}',
    });
  }

  if (isTank) {
    h.push({
      magnitud: 'nivel de tanque',
      unidadProbable: max <= 100 ? '% o m' : 'm³',
      razon: `el buffer está nominalmente dedicado a un tanque y el valor (${min}–${max}) es compatible`,
    });
  }

  if (!allInt) {
    if (min >= 0 && max <= 14) {
      h.push({
        magnitud: 'pH',
        unidadProbable: 'pH',
        razon: `valor real en 0–14 (${min}–${max}), rango canónico de pH`,
      });
      h.push({
        magnitud: 'nivel',
        unidadProbable: 'm',
        razon: `valor real bajo (${min}–${max}), compatible con nivel en metros`,
      });
    }
    if (min >= 0 && max <= 100) {
      h.push({
        magnitud: 'porcentaje',
        unidadProbable: '%',
        razon: `valor real en 0–100 (${min}–${max})`,
      });
    }
    if (min >= 0 && max <= 1000) {
      h.push({
        magnitud: 'caudal / presión / turbidez',
        unidadProbable: 'L/s, m³/h, PSI o NTU',
        razon: `valor real en 0–1000 (${min}–${max}): varias magnitudes de proceso caen aquí; indistinguible sin el programa del PLC`,
      });
    }
  }

  if (allInt && (max > 1 || min < 0)) {
    if (min >= 0 && max <= 32767 && channelKind.includes('INT')) {
      h.push({
        magnitud: 'palabra de bits empaquetados (estados/comandos discretos)',
        unidadProbable: 'bitmask INT16',
        razon: `entero en rango INT16 (${min}–${max}); en este PLC los INT transportan estados/comandos empaquetados por bit`,
      });
    }
    if (min >= 0 && max <= 4095) {
      h.push({
        magnitud: 'valor RAW de conversor A/D',
        unidadProbable: 'cuentas (12 bit)',
        razon: `entero en 0–4095 (${min}–${max}), rango típico de conversor de 12 bits`,
      });
    }
    if (min >= 3000 && max <= 21000) {
      h.push({
        magnitud: 'valor RAW de lazo 4–20 mA escalado',
        unidadProbable: 'µA ×1000',
        razon: `entero en 3000–21000 (${min}–${max}), típico de 4–20 mA escalado`,
      });
    }
  }

  if (h.length === 0) {
    h.push({
      magnitud: 'desconocida',
      unidadProbable: '—',
      razon: `rango observado ${min}–${max} sin correspondencia con ningún patrón conocido`,
    });
  }
  return h;
}

function procedureFor(sig: Omit<Signal, 'procedimientoValidacion' | 'estado'>): string {
  const ref = sig.arrayIndex !== null
    ? `${sig.bufferBrowseName}[${sig.arrayIndex}]`
    : sig.bufferBrowseName;

  if (sig.channelKind === 'DATA_OUT_INT' || sig.channelKind === 'DATA_OUT_REAL') {
    return (
      `COMANDO CANDIDATO — NO ESCRIBIR HASTA VALIDAR. ` +
      `1) En UAExpert, suscribir el NodeId ${sig.nodeId} (array completo) y observar ${ref}. ` +
      `2) Solicitar al operador de planta que accione LOCALMENTE el equipo del sitio ${sig.site ?? '(sitio)'} ` +
      `(p. ej. abrir una electroválvula desde el tablero) y registrar qué índice del buffer de entrada cambia. ` +
      `3) Confirmar con el integrador, sobre el programa del PLC (export L5X), qué equipo escribe la lógica en ${ref} ` +
      `y con qué codificación (bit, valor, pulso). ` +
      `4) Solo después de (3), y en ventana de mantenimiento con el equipo en local/aislado, validar la escritura.`
    );
  }

  return (
    `1) En UAExpert, suscribir el NodeId ${sig.nodeId} y observar el índice ${sig.arrayIndex ?? '—'} durante un ciclo de operación. ` +
    `2) Contrastar la evolución de ${ref} con la lectura física del instrumento en el sitio ${sig.site ?? '(sitio)'} ` +
    `(nivel del tanque, caudalímetro, manómetro, analizador). ` +
    `3) Confirmar magnitud, unidad y escalamiento con el export L5X del programa del PLC local.`
  );
}

export function expandSignals(readings: VariableReading[]): Signal[] {
  const signals: Signal[] = [];

  for (const r of readings) {
    // SymbolName es metadato del driver EtherNet/IP, no una señal de proceso.
    if (r.browseName === 'SymbolName') continue;

    // El sitio y el canal se determinan por el tag ANCESTRO de nivel superior
    // (p. ej. el miembro "DN" pertenece a "MSG_READ_VORAGINE"), no por el
    // browseName de la hoja, que en las estructuras MSG no lleva el sitio.
    const topLevel = topLevelTagName(r.fullBrowsePath, r.browseName);
    const channel = classifyChannel(topLevel);
    const site = extractSite(topLevel) ?? extractSite(r.browseName);
    const tank = tankHint(topLevel) ?? tankHint(r.browseName);
    const isMsgMember = channel.kind === 'MSG_CONTROL' && r.browseName !== topLevel;
    const isTankBuffer = tank !== null;
    const first = r.samples[0];
    const isArray = Array.isArray(first?.value);
    const statusCode = first?.statusCode.name ?? 'Unknown';
    const dataType = r.attrs.dataType.name;
    const isInteger = /Int|Byte|SByte/i.test(dataType);

    const emit = (
      index: number | null,
      arrayLength: number | null,
      samples: Array<number | boolean | string | null>,
    ): void => {
      const nums = numericSamples(samples);
      const min = nums.length ? Math.min(...nums) : null;
      const max = nums.length ? Math.max(...nums) : null;
      const evaluable = nums.length >= 2;
      let monotonic = evaluable;
      for (let i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) monotonic = false;
      monotonic = monotonic && (max ?? 0) > (min ?? 0);
      const allZero = nums.length > 0 && nums.every((v) => v === 0);

      const evidence = [...channel.evidence];
      if (site) evidence.push(`sitio "${site}" extraído del nombre del buffer`);
      if (isTankBuffer) evidence.push(`el nombre del buffer indica tanque (${tank})`);
      if (index !== null) {
        evidence.push(
          `elemento ${index} de un array de ${arrayLength}; el PLC NO nombra los elementos y el modelo del HMI Optix está vacío`,
        );
      }

      const isMsgOrIo = channel.kind === 'MSG_CONTROL' || channel.kind === 'LOCAL_IO';
      const hypotheses = isMsgOrIo
        ? []
        : hypothesize(nums, isInteger, monotonic, channel.kind, isTankBuffer);

      // Solo los diagnósticos MSG y la E/S del chasis tienen semántica documentada
      // por Rockwell; todo lo demás es hipótesis sobre índices anónimos.
      const confidence: Confidence = isMsgOrIo ? 'alta' : allZero ? 'nula' : 'baja';

      const base = {
        id: index !== null ? `${r.browseName}[${index}]` : r.browseName,
        nodeId: r.nodeId,
        bufferBrowseName: r.browseName,
        fullBrowsePath: r.fullBrowsePath,
        arrayIndex: index,
        arrayLength,
        site,
        tank,
        channelKind: channel.kind,
        direction: channel.direction,
        dataType,
        writableByServer: r.attrs.accessLevel.currentWrite,
        writableByUser: r.attrs.userAccessLevel.currentWrite,
        samples,
        statusCode,
        movement: {
          muestrasBuenas: nums.length,
          evaluable,
          changed: evaluable && min !== max,
          min,
          max,
          monotonicNonDecreasing: monotonic,
          allZero,
        },
        hypotheses,
        confidence,
        evidence,
      };

      signals.push({
        ...base,
        estado: isMsgOrIo ? 'CONFIRMADO' : 'REQUIERE VALIDACIÓN EN PLANTA',
        procedimientoValidacion: isMsgOrIo ? null : procedureFor(base),
      });
    };

    if (isArray) {
      const arrays = r.samples.map((s) => (Array.isArray(s.value) ? (s.value as unknown[]) : []));
      const length = arrays[0]?.length ?? 0;
      for (let i = 0; i < length; i++) {
        emit(
          i,
          length,
          arrays.map((a) => (a[i] as number | boolean | string | null) ?? null),
        );
      }
    } else {
      emit(
        null,
        null,
        r.samples.map((s) => (s.value as number | boolean | string | null) ?? null),
      );
    }
  }

  return signals;
}
