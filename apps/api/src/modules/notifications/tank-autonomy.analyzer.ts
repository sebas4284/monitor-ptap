import type { PlantSnapshotDto, SignalDto } from '@ptap/shared';

/**
 * Cuánto aguanta el tanque: horas hasta el 50 % y hasta quedar vacío.
 *
 * El cliente lo pidió como «vida útil de la planta» (2026-08-20). Su propósito es que el operario
 * decida CON CRITERIO antes de cerrar la entrada, no enterarse cuando ya no hay agua.
 *
 * ── De dónde sale el volumen ──────────────────────────────────────────────────────────────────
 * El mapping NO tiene la capacidad del tanque: `tankNVolume.max` es una cota de plausibilidad
 * (10 000 m³), no una capacidad real. Pero sí llegan nivel y volumen en vivo, y su cociente da el
 * ÁREA de la sección:
 *
 *     área (m²) = volumen (m³) / nivel (m)
 *
 * Ese cociente ya se validó en campo: Soledad daba 59,6 m²/m y Sirena 59,5. Fue justamente esa
 * coherencia la que permitió concluir que el nivel negativo de Soledad era un signo invertido en el
 * PLC y no un volumen mal calculado.
 *
 * ── Por qué el número no debe bailar ──────────────────────────────────────────────────────────
 * Una autonomía recalculada con el caudal instantáneo salta de 5 h a 3 h y vuelve a 5 h en un
 * minuto, y un número así no se puede usar para decidir nada. El cliente pidió expresamente que se
 * comporte como un TEMPORIZADOR: se fija una vez y corre solo, y solo se vuelve a fijar cuando el
 * caudal cambia de verdad. Ver `debeRecalcular`.
 */

/** Un litro por segundo son 3,6 m³ por hora. */
const LPS_A_M3H = 3.6;

/**
 * Banda muerta: mientras el caudal de salida no se aparte MÁS de esto del caudal de referencia con
 * el que se fijó el temporizador, el número no se vuelve a calcular (l/s).
 *
 * 0,3 l/s por decisión de operación (2026-08-22). Antes eran 0,2 y el temporizador se refijaba con
 * demasiada frecuencia: la autonomía es un número para decidir si cerrar la entrada, y uno que se
 * mueve cada minuto no sirve para decidir nada.
 *
 * Hubo aquí un segundo umbral (0,6 l/s) que forzaba recálculo «inmediato» sin esperar al minuto. Se
 * retiró porque era inalcanzable: `intervaloMinimoMs` ES el periodo del barrido
 * (`tank-autonomy.detector.ts`), así que en cada pasada el minuto ya venció y la rama del tick
 * decidía siempre lo mismo. Una constante que aparenta gobernar algo y no gobierna nada es peor que
 * no tenerla.
 */
export const BANDA_MUERTA_LPS = 0.3;

/** Caudal por debajo del cual se considera que la entrada está cerrada (l/s). */
export const ENTRADA_CERRADA_LPS = 0.1;

/**
 * Tolerancia para comparar caudales en los bordes exactos de las bandas.
 *
 * Sin esto, un caudal justo en el límite cae del lado equivocado por punto flotante: `2 + 0.2` da
 * `2.2000000000000002`, cuya diferencia con 2 es mayor que 0,2 y disparaba un recálculo que el
 * cliente había pedido evitar. Un caudalímetro no tiene precisión de picolitro; comparar sus
 * lecturas al bit es una precisión falsa.
 */
const EPSILON_LPS = 1e-9;

/** Fracción del máximo que el cliente considera el punto en que el tanque deja de ser funcional. */
export const FRACCION_CRITICA = 0.5;

/** Por debajo de esta autonomía el aviso es crítico, sea cual sea el porcentaje (horas). */
export const AUTONOMIA_CRITICA_H = 1;

/** Umbrales a los que se reemite el aviso al dispositivo (horas). */
export const UMBRALES_AVISO_H = [6, 3, 1];

/**
 * Cómo se obtuvo el caudal con el que se calculó la autonomía. Viaja al front porque cambia lo que
 * el número SIGNIFICA: uno es una cuenta atrás real y el otro un supuesto.
 */
export type OrigenCaudal =
  /** La entrada está cerrada: el tanque se vacía de verdad y esto es una cuenta atrás. */
  | 'vaciado_real'
  /** La entrada está abierta: proyección de «si cerraras ahora», con el promedio de 24 h. */
  | 'proyeccion_24h';

export interface AutonomiaTanque {
  tankN: number;
  label: string;
  levelM: number;
  maxM: number;
  /** Porcentaje de llenado sobre el máximo declarado. */
  pct: number;
  /** Área de la sección deducida de volumen/nivel (m²). null si falta alguno de los dos. */
  areaM2: number | null;
  volumeM3: number | null;
  /** Caudal usado para el cálculo (l/s) y de dónde salió. */
  caudalLps: number;
  origen: OrigenCaudal;
  /** Horas hasta llegar al 50 %. 0 si ya está por debajo. null si no se puede calcular. */
  horasHasta50: number | null;
  /** Horas hasta quedar vacío. null si no se puede calcular. */
  horasHasta0: number | null;
}

/** Estado que sobrevive entre barridos: el temporizador vigente de un tanque. */
export interface TemporizadorTanque {
  /** Caudal con el que se fijó este temporizador (l/s). La comparación se hace SIEMPRE contra él. */
  caudalFijadoLps: number;
  /** Cuándo se fijó (epoch ms). */
  fijadoEnMs: number;
  horasHasta50: number | null;
  horasHasta0: number | null;
  origen: OrigenCaudal;
}

function numeric(sig: SignalDto | undefined): number | null {
  return sig && typeof sig.value === 'number' && Number.isFinite(sig.value) ? sig.value : null;
}

/**
 * ¿Hay que volver a fijar el temporizador?
 *
 * Una sola regla, que es la que dio operación: **cada minuto se mira el caudal de salida y solo se
 * recalcula si se aparta más de 0,3 l/s del caudal de referencia** con el que se fijó el número.
 * Por debajo de eso el reloj sigue corriendo, que es lo que lo hace utilizable para decidir.
 *
 * La comparación va SIEMPRE contra el caudal con el que se fijó el temporizador, nunca contra el del
 * minuto anterior: si se comparase con el anterior, una deriva lenta de 0,2 l/s por minuto nunca
 * dispararía el recálculo y en media hora el número sería pura ficción.
 */
export function debeRecalcular(
  previo: TemporizadorTanque | undefined,
  caudalActualLps: number,
  ahoraMs: number,
  intervaloMinimoMs: number,
): { recalcular: boolean; motivo: 'primera_vez' | 'tick' | 'banda_muerta' } {
  if (!previo) return { recalcular: true, motivo: 'primera_vez' };

  const delta = Math.abs(caudalActualLps - previo.caudalFijadoLps);
  if (delta <= BANDA_MUERTA_LPS + EPSILON_LPS) return { recalcular: false, motivo: 'banda_muerta' };

  const vencido = ahoraMs - previo.fijadoEnMs >= intervaloMinimoMs;
  return vencido ? { recalcular: true, motivo: 'tick' } : { recalcular: false, motivo: 'banda_muerta' };
}

/**
 * Caudal de salida de la planta, mirando las claves habituales en orden.
 * Mismo criterio que `inletFlow` en `tank-overflow.analyzer.ts`.
 */
export function outletFlow(signals: Record<string, SignalDto>): number | null {
  for (const k of ['outletFlow1', 'outletFlow2']) {
    const v = numeric(signals[k]);
    if (v !== null) return v;
  }
  return null;
}

/** Caudal de entrada, para saber si el tanque se está vaciando de verdad. */
export function inletFlow(signals: Record<string, SignalDto>): number | null {
  for (const k of ['inletFlow1', 'inletFlow2']) {
    const v = numeric(signals[k]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Horas hasta que el nivel baje de `desdeM` a `hastaM` con un caudal dado.
 *
 * Devuelve 0 si ya se está por debajo del objetivo (no se inventan horas negativas) y `null` si no
 * hay con qué calcular: sin área o sin caudal la respuesta honesta es "no se sabe", no un número.
 */
export function horasHasta(
  areaM2: number | null,
  desdeM: number,
  hastaM: number,
  caudalLps: number,
): number | null {
  if (areaM2 === null || areaM2 <= 0) return null;
  if (caudalLps <= 0) return null;
  if (desdeM <= hastaM) return 0;
  const volumenUtilM3 = areaM2 * (desdeM - hastaM);
  return volumenUtilM3 / (caudalLps * LPS_A_M3H);
}

/**
 * Calcula la autonomía de los tanques de una planta.
 *
 * `caudalProyeccionLps` es el promedio de salida de las últimas 24 h; se usa SOLO cuando la entrada
 * está abierta, para responder «¿cuánto aguantaría si cierro ahora?». Si aún no hay 24 h de
 * historia llega `null` y no se proyecta nada: es mejor no decir nada que dar un promedio de dos
 * muestras como si fuera el consumo del día.
 */
export function analizarAutonomia(
  snapshot: PlantSnapshotDto,
  caudalProyeccionLps: number | null,
): AutonomiaTanque[] {
  const out: AutonomiaTanque[] = [];
  const entrada = inletFlow(snapshot.signals);
  const salidaActual = outletFlow(snapshot.signals);
  const entradaCerrada = entrada === null || entrada <= ENTRADA_CERRADA_LPS;

  // Con la entrada ABIERTA el tanque no se está vaciando: el volumen queda congelado y lo único
  // honesto es una proyección con el consumo típico del día. Con la entrada CERRADA sí hay un
  // vaciado real y manda el caudal de salida de ahora.
  const caudalLps = entradaCerrada ? salidaActual : caudalProyeccionLps;
  const origen: OrigenCaudal = entradaCerrada ? 'vaciado_real' : 'proyeccion_24h';
  if (caudalLps === null || caudalLps <= 0) return out;

  for (const [key, signal] of Object.entries(snapshot.signals)) {
    const m = /^tank(\d+)Level$/.exec(key);
    if (!m) continue;
    const tankN = Number(m[1]);
    const levelM = numeric(signal);
    const maxM = typeof signal.opMax === 'number' ? signal.opMax : null;
    if (levelM === null || maxM === null || maxM <= 0) continue;
    // Un nivel negativo es un sensor que miente (Soledad reporta −1,51 m con timestamp fresco). Lo
    // trata el aviso de rango físico; aquí calcular una autonomía sería darle crédito.
    if (levelM < 0) continue;

    const volumeM3 = numeric(snapshot.signals[`tank${tankN}Volume`]);
    const areaM2 = volumeM3 !== null && levelM > 0 ? volumeM3 / levelM : null;
    const nivel50 = maxM * FRACCION_CRITICA;

    out.push({
      tankN,
      label: signal.label ?? `Tanque ${tankN}`,
      levelM,
      maxM,
      pct: (levelM / maxM) * 100,
      areaM2,
      volumeM3,
      caudalLps,
      origen,
      horasHasta50: horasHasta(areaM2, levelM, nivel50, caudalLps),
      horasHasta0: horasHasta(areaM2, levelM, 0, caudalLps),
    });
  }
  return out;
}

/** Horas y minutos en lenguaje de operador: «3 h 20 min», «45 min». */
export function humanHoras(horas: number): string {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`;
  const h = Math.floor(horas);
  const min = Math.round((horas - h) * 60);
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}
