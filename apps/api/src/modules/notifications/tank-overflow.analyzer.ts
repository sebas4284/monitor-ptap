import type { PlantSnapshotDto, SignalDto } from '@ptap/shared';

/**
 * ¿Por qué un tanque marca más del 100 %?
 *
 * Solo hay dos explicaciones, y piden acciones OPUESTAS:
 *
 *  - **Se está rebosando**: el agua sale por el rebosadero y se pierde. Es un problema de
 *    operación, hay que actuar en la planta.
 *  - **El máximo está mal medido**: el tanque admite más de lo que dice la configuración. No pasa
 *    nada en la planta; lo que hay que corregir es nuestro dato.
 *
 * Avisar de lo uno cuando pasa lo otro es peor que no avisar: mandar a alguien a mirar un rebose
 * inexistente quema la credibilidad de la bandeja, y dar por bueno un máximo equivocado deja al
 * operador con un tanque que marca "lleno" cuando todavía puede recibir agua.
 *
 * **La física distingue los dos casos.** Un tanque que rebosa NO PUEDE seguir subiendo: por
 * definición, lo que entra por encima del rebosadero se va. Entonces:
 *
 *  - nivel muy por encima del máximo, o subiendo todavía  → el máximo está mal
 *  - nivel estancado justo encima del máximo, con caudal entrando → se está rebosando de verdad
 *
 * Ese "con caudal entrando" es lo que cierra el argumento: si entra agua y el nivel no sube, el
 * agua se está yendo por algún lado. Sin caudal de entrada no se puede afirmar, y se dice.
 *
 * Medido en campo el 2026-08-15: Carbonero a 2.96 m con máximo 2.80 (105,8 %) y Vorágine a 1.98
 * con máximo 1.97 (100,3 %). Ninguno había derramado agua.
 */

/** Por encima de esto, un rebosadero real no puede sostener el nivel: el máximo está mal. */
const TOLERANCIA_REBOSE_PCT = 3;
/** Cambio de nivel que se considera movimiento real y no ruido del sensor (m). */
const CAMBIO_SIGNIFICATIVO_M = 0.01;
/** Caudal por debajo del cual no se puede afirmar que "está entrando agua" (l/s). */
const CAUDAL_MINIMO_LPS = 0.1;
/**
 * Antigüedad a partir de la cual NO se juzga el nivel. Mismo umbral y mismo motivo que el detector
 * de frescura: alarmar por un valor que ya sabemos viejo es ruido, y además apunta a la causa
 * equivocada — el problema es el sensor, no el tanque.
 *
 * Lo destapó el primer despliegue (2026-08-15): KM18 lleva 25 días congelada con el nivel clavado
 * en 0.00 m y salió un aviso crítico de "el tanque bajó del mínimo de servicio". Ese tanque no ha
 * bajado de nada; lo que pasa es que nadie sabe cómo está.
 */
const ANTIGUEDAD_MAXIMA_H = Number(process.env.NOTIFY_STALE_HOURS ?? 1);

function edadHoras(ts: string | null | undefined, now: Date): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : null;
}

export type TankVerdict =
  | 'rebosando'
  | 'maximo_mal'
  | 'indeterminado'
  // Extremo BAJO. El mínimo de 1 m no es el fondo del tanque: es el nivel por debajo del cual la
  // planta **no consigue llevar agua a las casas** (regla del cliente, 2026-08-15). Que el tanque
  // pueda bajar más no lo hace inofensivo — lo hace el aviso más accionable de la bandeja.
  | 'bajo_minimo_cayendo'
  | 'bajo_minimo_recuperando';

export interface TankSample {
  levelM: number;
  atMs: number;
}

export interface TankFinding {
  tankN: number;
  label: string;
  levelM: number;
  maxM: number;
  /** Cuánto pasa del 100 % (p. ej. 5.8 para 105,8 %). */
  excessPct: number;
  verdict: TankVerdict;
  volumeM3: number | null;
  inletFlowLps: number | null;
  /** Cambio de nivel desde la muestra anterior (m). null = aún sin historial. */
  trendM: number | null;
  /** Máximo que los datos respaldan: el nivel más alto que hemos visto de verdad. */
  suggestedMaxM: number;
  title: string;
  message: string;
}

function numeric(sig: SignalDto | undefined): number | null {
  return sig && typeof sig.value === 'number' && Number.isFinite(sig.value) ? sig.value : null;
}

/** Caudal de entrada de la planta, mirando las claves habituales en orden. */
function inletFlow(signals: Record<string, SignalDto>): number | null {
  for (const k of ['inletFlow1', 'inletFlow2']) {
    const v = numeric(signals[k]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Distancia en cm, sin redondear a cero.
 *
 * `Math.round(0.007 * 100)` da 0, y en producción salió el aviso "El nivel está 0 cm por encima del
 * máximo" (Vorágine, 2026-08-15: eran 7 mm). Un aviso que se contradice a sí mismo hace dudar de
 * todos los demás.
 */
function cm(m: number): string {
  const abs = Math.abs(m);
  if (abs < 0.01) return 'menos de 1 cm';
  return `${Math.round(abs * 100)} cm`;
}

/**
 * Los datos que el cliente pidió que acompañaran a TODO aviso de tanque: nivel, máximo, volumen y
 * caudal de entrada. Sin ellos el operador no puede decidir si el aviso merece un viaje a planta.
 */
function contextoDe(
  snapshot: PlantSnapshotDto,
  tankN: number,
  levelM: number,
  maxM: number | null,
  caudal: number | null,
): string {
  const volumen = numeric(snapshot.signals[`tank${tankN}Volume`]);
  return [
    `nivel ${levelM.toFixed(2)} m`,
    maxM !== null && maxM > 0 ? `máximo configurado ${maxM.toFixed(2)} m` : 'sin máximo declarado',
    volumen !== null ? `volumen ${volumen.toFixed(1)} m³` : null,
    caudal !== null ? `caudal de entrada ${caudal.toFixed(1)} l/s` : 'sin caudal de entrada mapeado',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Analiza los tanques de un snapshot y devuelve los que se salen de su franja de operación, por
 * arriba (rebose o máximo mal medido) o por abajo (mínimo de servicio).
 *
 * @param historial nivel anterior por tanque (clave `tank<N>`), para saber si sigue subiendo.
 */
export function analyzeTanks(
  snapshot: PlantSnapshotDto,
  displayName: string,
  historial: Map<string, TankSample>,
  maxObservado: Map<string, number>,
  now: Date = new Date(),
): TankFinding[] {
  const out: TankFinding[] = [];
  const caudal = inletFlow(snapshot.signals);

  for (const [key, signal] of Object.entries(snapshot.signals)) {
    const m = /^tank(\d+)Level$/.exec(key);
    if (!m) continue;
    const tankN = Number(m[1]);
    const levelM = numeric(signal);
    const maxM = signal.opMax ?? null;
    const minM = signal.opMin ?? null;
    if (levelM === null) continue;

    // Un nivel viejo no se juzga: el aviso correcto lo da el detector de frescura.
    const edad = edadHoras(signal.ts, now);
    if (edad !== null && edad >= ANTIGUEDAD_MAXIMA_H) continue;

    const previo = historial.get(`tank${tankN}`);
    const trend = previo ? levelM - previo.levelM : null;

    // ── Extremo BAJO: por debajo del mínimo de servicio ────────────────────────────────────
    // Va ANTES del máximo porque no depende de `opMax`: Campoalegre no tiene máximo declarado y
    // aun así su tanque 3 bajó del metro (0.986 m, 2026-08-15). Sin esta rama nadie se enteraba.
    if (minM !== null && levelM < minM) {
      // Un nivel negativo no es "muy bajo", es un sensor que miente: lo trata el aviso de rango
      // físico, no este. Soledad reporta -1.51 m con timestamp fresco (signo invertido en el PLC).
      if (levelM < 0) continue;

      const cayendo = trend === null || trend < -CAMBIO_SIGNIFICATIVO_M;
      const sinEntrada = caudal === null || caudal <= CAUDAL_MINIMO_LPS;
      const verdict: TankVerdict = cayendo || sinEntrada ? 'bajo_minimo_cayendo' : 'bajo_minimo_recuperando';

      const situacion =
        verdict === 'bajo_minimo_cayendo'
          ? `Está ${cm(minM - levelM)} por debajo y ${sinEntrada ? 'NO está entrando agua' : 'sigue bajando'}.`
          : `Está ${cm(minM - levelM)} por debajo, pero recuperándose (+${cm(trend as number)} desde la última revisión).`;

      out.push({
        tankN,
        label: signal.label ?? `Tanque ${tankN}`,
        levelM,
        maxM: maxM ?? 0,
        excessPct: 0,
        verdict,
        volumeM3: numeric(snapshot.signals[`tank${tankN}Volume`]),
        inletFlowLps: caudal,
        trendM: trend,
        suggestedMaxM: Math.max(maxObservado.get(`tank${tankN}`) ?? 0, levelM),
        title: `${displayName}: el tanque ${tankN} está por debajo del mínimo de servicio`,
        message:
          `El nivel (${levelM.toFixed(2)} m) bajó del mínimo de servicio (${minM.toFixed(2)} m). ` +
          'Por debajo de ese nivel la planta no consigue llevar agua a las casas. ' +
          `${situacion} Datos: ${contextoDe(snapshot, tankN, levelM, maxM, caudal)}.`,
      });
      continue;
    }

    // ── Extremo ALTO ───────────────────────────────────────────────────────────────────────
    // Sin máximo declarado no hay nada que afirmar arriba (los tres de Campoalegre).
    if (maxM === null || maxM <= 0) continue;
    if (levelM <= maxM) continue;

    const excessPct = (levelM / maxM) * 100 - 100;
    const trendM = trend;
    const suggestedMaxM = Math.max(maxObservado.get(`tank${tankN}`) ?? 0, levelM);

    let verdict: TankVerdict;
    let porque: string;
    let recomendacion: string;

    if (excessPct > TOLERANCIA_REBOSE_PCT) {
      verdict = 'maximo_mal';
      porque =
        `El nivel está ${cm(levelM - maxM)} por encima del máximo configurado. Un tanque que rebosa ` +
        'no puede subir tanto sobre su rebosadero: el agua sobrante se va sola.';
      recomendacion = `Lo más probable es que el máximo esté mal medido. Los datos respaldan al menos ${suggestedMaxM.toFixed(2)} m.`;
    } else if (trendM !== null && trendM > CAMBIO_SIGNIFICATIVO_M) {
      verdict = 'maximo_mal';
      porque = `El nivel SIGUE SUBIENDO (+${cm(trendM)} desde la última revisión) estando ya por encima del máximo.`;
      recomendacion = `Si estuviera rebosando no podría seguir subiendo. Revisar el máximo: los datos respaldan al menos ${suggestedMaxM.toFixed(2)} m.`;
    } else if (
      trendM !== null &&
      Math.abs(trendM) <= CAMBIO_SIGNIFICATIVO_M &&
      caudal !== null &&
      caudal > CAUDAL_MINIMO_LPS
    ) {
      verdict = 'rebosando';
      porque =
        `Entran ${caudal.toFixed(1)} l/s y el nivel NO sube (${cm(Math.abs(trendM))} de cambio). ` +
        'Si entra agua y el nivel se mantiene, el agua se está yendo por el rebosadero.';
      recomendacion = 'Revisar la planta: se está perdiendo agua tratada.';
    } else {
      verdict = 'indeterminado';
      porque =
        `El nivel está ${cm(levelM - maxM)} por encima del máximo` +
        (trendM === null ? ', y aún no hay historial suficiente para saber si sube o se mantiene.' : ` y ${trendM < 0 ? 'está bajando' : 'se mantiene'}.`) +
        (caudal === null ? ' Esta planta no tiene caudal de entrada mapeado, así que no se puede confirmar un rebose.' : '');
      recomendacion = `Vigilar. Si se repite sin llegar a derramar, el máximo configurado (${maxM.toFixed(2)} m) está corto.`;
    }

    const pctTxt = `${(100 + excessPct).toFixed(1)} %`;
    const contexto = contextoDe(snapshot, tankN, levelM, maxM, caudal);

    out.push({
      tankN,
      label: signal.label ?? `Tanque ${tankN}`,
      levelM,
      maxM,
      excessPct,
      verdict,
      volumeM3: numeric(snapshot.signals[`tank${tankN}Volume`]),
      inletFlowLps: caudal,
      trendM,
      suggestedMaxM,
      title:
        verdict === 'rebosando'
          ? `${displayName}: el tanque ${tankN} se está rebosando`
          : `${displayName}: el tanque ${tankN} pasa del máximo (${pctTxt})`,
      message: `${porque} ${recomendacion} Datos: ${contexto}.`,
    });
  }

  return out;
}
