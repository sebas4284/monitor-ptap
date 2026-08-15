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

export type TankVerdict = 'rebosando' | 'maximo_mal' | 'indeterminado';

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

function cm(m: number): string {
  return `${Math.round(m * 100)} cm`;
}

/**
 * Analiza los tanques de un snapshot y devuelve solo los que pasan de su máximo.
 *
 * @param historial nivel anterior por tanque (clave `tank<N>`), para saber si sigue subiendo.
 */
export function analyzeTanks(
  snapshot: PlantSnapshotDto,
  displayName: string,
  historial: Map<string, TankSample>,
  maxObservado: Map<string, number>,
): TankFinding[] {
  const out: TankFinding[] = [];
  const caudal = inletFlow(snapshot.signals);

  for (const [key, signal] of Object.entries(snapshot.signals)) {
    const m = /^tank(\d+)Level$/.exec(key);
    if (!m) continue;
    const tankN = Number(m[1]);
    const levelM = numeric(signal);
    const maxM = signal.opMax ?? null;
    // Sin nivel o sin máximo declarado no hay nada que afirmar. Campoalegre está aquí: sus tres
    // tanques no tienen máximo, así que ni siquiera se les calcula porcentaje.
    if (levelM === null || maxM === null || maxM <= 0) continue;
    if (levelM <= maxM) continue;

    const excessPct = (levelM / maxM) * 100 - 100;
    const previo = historial.get(`tank${tankN}`);
    const trendM = previo ? levelM - previo.levelM : null;
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
    const contexto = [
      `nivel ${levelM.toFixed(2)} m`,
      `máximo configurado ${maxM.toFixed(2)} m`,
      snapshot.signals[`tank${tankN}Volume`] !== undefined && numeric(snapshot.signals[`tank${tankN}Volume`]) !== null
        ? `volumen ${numeric(snapshot.signals[`tank${tankN}Volume`])!.toFixed(1)} m³`
        : null,
      caudal !== null ? `caudal de entrada ${caudal.toFixed(1)} l/s` : 'sin caudal de entrada mapeado',
    ]
      .filter(Boolean)
      .join(' · ');

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
