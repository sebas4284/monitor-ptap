/**
 * FASES 3, 5, 6, 8, 9 y 11 — reconstrucción del modelo industrial.
 *
 * Se agrupa por SITIO (cada sitio remoto = una planta/estación del sistema) porque
 * es la única agrupación con respaldo estructural: está codificada en el nombre de
 * los buffers y en la instrucción MSG que los transporta.
 */
import type { Signal } from './signals';
import { MSG_MEMBERS } from './tokens';

export interface SiteModel {
  site: string;
  buffers: {
    entradaReal: string[];
    entradaInt: string[];
    entradaBit: string[];
    salidaReal: string[];
    salidaInt: string[];
    mensajeria: string[];
  };
  señalesEntrada: number;
  señalesSalida: number;
  comunicacion: {
    estado: 'OK' | 'ERROR' | 'SIN_DATO';
    evidencia: string[];
    msgNodeIds: string[];
  };
  dispositivosInferidos: Array<{
    tipo: string;
    referencia: string;
    estado: string;
    razon: string;
  }>;
  estado: 'REQUIERE VALIDACIÓN EN PLANTA';
}

/** Salud de la comunicación maestro↔sitio a partir de los bits DN/ER/TO de la MSG. */
function commHealth(msgSignals: Signal[]): SiteModel['comunicacion'] {
  const evidencia: string[] = [];
  const bitValue = (member: string): boolean | null => {
    // Coincidencia exacta del miembro por browseName de la hoja; se prefiere la
    // instrucción de LECTURA (MSG_READ), que es la que refleja la vigencia de los datos.
    const candidatos = msgSignals.filter((x) => x.bufferBrowseName.toUpperCase() === member);
    const s =
      candidatos.find((x) => x.fullBrowsePath.toUpperCase().includes('MSG_READ')) ?? candidatos[0];
    if (!s) return null;
    const v = s.samples[0];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return null;
  };

  const dn = bitValue('DN');
  const er = bitValue('ER');
  const to = bitValue('TO');

  if (dn !== null) evidencia.push(`MSG.DN=${dn} (${MSG_MEMBERS.DN})`);
  if (er !== null) evidencia.push(`MSG.ER=${er} (${MSG_MEMBERS.ER})`);
  if (to !== null) evidencia.push(`MSG.TO=${to} (${MSG_MEMBERS.TO})`);

  let estado: SiteModel['comunicacion']['estado'] = 'SIN_DATO';
  if (er === true || to === true) estado = 'ERROR';
  else if (dn === true) estado = 'OK';

  return {
    estado,
    evidencia,
    msgNodeIds: [...new Set(msgSignals.map((s) => s.nodeId))],
  };
}

export function buildSiteModels(signals: Signal[]): SiteModel[] {
  const sites = [...new Set(signals.map((s) => s.site).filter((s): s is string => !!s))].sort();

  return sites.map((site) => {
    const mine = signals.filter((s) => s.site === site);
    const uniqueBuffers = (pred: (s: Signal) => boolean): string[] =>
      [...new Set(mine.filter(pred).map((s) => s.bufferBrowseName))].sort();

    const msgSignals = mine.filter((s) => s.channelKind === 'MSG_CONTROL');
    const entrada = mine.filter((s) => s.direction === 'plc_local→maestro');
    const salida = mine.filter((s) => s.direction === 'maestro→plc_local');

    const dispositivos: SiteModel['dispositivosInferidos'] = [];

    const tankBuffers = [...new Set(mine.filter((s) => s.tank).map((s) => s.bufferBrowseName))];
    for (const b of tankBuffers) {
      dispositivos.push({
        tipo: 'Tanque',
        referencia: b,
        estado: 'REQUIERE VALIDACIÓN EN PLANTA',
        razon: `el nombre del buffer "${b}" denota un tanque, pero el significado de cada índice del array no está expuesto por OPC UA`,
      });
    }

    if (salida.length > 0) {
      dispositivos.push({
        tipo: 'Actuadores (electroválvulas / bombas)',
        referencia: uniqueBuffers((s) => s.direction === 'maestro→plc_local').join(', '),
        estado: 'REQUIERE VALIDACIÓN EN PLANTA',
        razon:
          'existen buffers de salida escribibles hacia el PLC local (canal de comando), pero no hay ningún tag que identifique el actuador ni la codificación del comando',
      });
    }

    return {
      site,
      buffers: {
        entradaReal: uniqueBuffers((s) => s.channelKind === 'DATA_IN_REAL'),
        entradaInt: uniqueBuffers((s) => s.channelKind === 'DATA_IN_INT'),
        entradaBit: uniqueBuffers((s) => s.channelKind === 'DATA_IN_BIT'),
        salidaReal: uniqueBuffers((s) => s.channelKind === 'DATA_OUT_REAL'),
        salidaInt: uniqueBuffers((s) => s.channelKind === 'DATA_OUT_INT'),
        mensajeria: uniqueBuffers((s) => s.channelKind === 'MSG_CONTROL'),
      },
      señalesEntrada: entrada.length,
      señalesSalida: salida.length,
      comunicacion: commHealth(msgSignals),
      dispositivosInferidos: dispositivos,
      estado: 'REQUIERE VALIDACIÓN EN PLANTA',
    };
  });
}

// ── FASE 11: estrategia de comunicación ────────────────────────────────────────
export interface PollingRule {
  patron: string;
  estrategia: 'subscription' | 'polling' | 'on_demand';
  intervaloMs: number;
  justificacion: string;
}

export function pollingStrategy(signals: Signal[]): PollingRule[] {
  const moved = signals.filter((s) => s.movement.changed).length;
  return [
    {
      patron: 'Buffers de proceso de entrada (REAL_IN_*, DATOS_IN_*, REAL_TK*)',
      estrategia: 'subscription',
      intervaloMs: 1000,
      justificacion:
        'Son los valores que el operador observa. Una sola subscription con MonitoredItems sobre el ARRAY COMPLETO (no por elemento) minimiza la carga sobre el HMI Optix: un item por buffer, no uno por índice. ' +
        `Se observó movimiento en ${moved} señales durante el muestreo, lo que confirma refresco activo.`,
    },
    {
      patron: 'Buffers de estado discreto (INT_IN_*, BIT_*)',
      estrategia: 'subscription',
      intervaloMs: 500,
      justificacion:
        'Estados de equipos y alarmas: la latencia importa y el cambio es esporádico, por lo que la subscription es más barata que el polling.',
    },
    {
      patron: 'Diagnóstico de mensajería (MSG_*: DN/ER/TO/ERR)',
      estrategia: 'subscription',
      intervaloMs: 2000,
      justificacion:
        'Determinan si los datos de un sitio son vigentes. Alimentan directamente ConnectionStatus por sitio en el backend: si MSG.ER o MSG.TO están activos, los datos de ese sitio deben marcarse como NO CONFIABLES en el frontend.',
    },
    {
      patron: 'Buffers de salida (INT_OUT_*, REAL_OUT_*)',
      estrategia: 'polling',
      intervaloMs: 5000,
      justificacion:
        'Se releen tras un comando para confirmar el eco de escritura. No requieren refresco rápido.',
    },
    {
      patron: 'Módulos de E/S del chasis (Local:N:C — configuración)',
      estrategia: 'on_demand',
      intervaloMs: 0,
      justificacion: 'Configuración estática del hardware: se lee una sola vez al conectar.',
    },
    {
      patron: 'Totalizadores (índices con crecimiento monótono confirmado)',
      estrategia: 'polling',
      intervaloMs: 30000,
      justificacion:
        'Acumuladores de volumen: cambian lentamente y no requieren resolución fina. Se separan del resto para no inflar la subscription.',
    },
  ];
}
