import type { PlantSnapshotDto, SignalDto } from '@ptap/shared';

/** Balance volumétrico: 1 l/s = 3,6 m³/h. Los bounds físicos no son capacidades. */
const LPS_A_M3H = 3.6;
export const BANDA_MUERTA_LPS = 0.3;
export const ENTRADA_CERRADA_LPS = 0.1;
const EPSILON_LPS = 1e-9;
export const FRACCION_CRITICA = 0.5;
export const AUTONOMIA_CRITICA_H = 1;
export const UMBRALES_AVISO_H = [6, 3, 1];

export type OrigenCaudal = 'vaciado_real' | 'proyeccion_24h' | 'proyeccion_actual' | 'tendencia_volumen' | 'tendencia_nivel';
export type ReservaOrigen = 'op_min' | '50_percent';
export type LimitacionAutonomia = 'multiple_tanks' | 'multiple_flows' | 'unmapped_flow';

export interface AutonomiaTanque {
  tankN: number;
  tankKey: string;
  label: string;
  levelM: number;
  /** 0 cuando no hay máximo operativo; pct entonces es null. */
  maxM: number;
  pct: number | null;
  /** Aproximación prismática V/h; no reemplaza una curva de aforo. */
  areaM2: number | null;
  volumeM3: number | null;
  caudalLps: number;
  origen: OrigenCaudal;
  horasHasta50: number | null;
  horasHasta0: number | null;
  horasHastaReserva: number | null;
  reservaM: number | null;
  reservaOrigen: ReservaOrigen | null;
  limitacion: LimitacionAutonomia | null;
}

/** Se estabiliza el caudal; el stock se vuelve a leer en cada barrido. */
export interface TemporizadorTanque {
  caudalFijadoLps: number;
  fijadoEnMs: number;
  horasHasta50: number | null;
  horasHasta0: number | null;
  horasHastaReserva?: number | null;
  origen: OrigenCaudal;
}

function numeric(sig: SignalDto | undefined): number | null {
  return sig?.usable && sig.quality === 'Good' && sig.mappingStatus === 'mapped' && !sig.outOfRange &&
    typeof sig.value === 'number' && Number.isFinite(sig.value) ? sig.value : null;
}

export function debeRecalcular(
  previo: TemporizadorTanque | undefined,
  caudalActualLps: number,
  ahoraMs: number,
  intervaloMinimoMs: number,
): { recalcular: boolean; motivo: 'primera_vez' | 'tick' | 'banda_muerta' } {
  if (!previo) return { recalcular: true, motivo: 'primera_vez' };
  const delta = Math.abs(caudalActualLps - previo.caudalFijadoLps);
  if (delta <= BANDA_MUERTA_LPS + EPSILON_LPS) return { recalcular: false, motivo: 'banda_muerta' };
  return ahoraMs - previo.fijadoEnMs >= intervaloMinimoMs
    ? { recalcular: true, motivo: 'tick' } : { recalcular: false, motivo: 'banda_muerta' };
}

function flowKeys(signals: Record<string, SignalDto>, side: 'inlet' | 'outlet'): string[] {
  return Object.keys(signals).filter((key) => new RegExp(`^${side}Flow\\d+$`).test(key));
}

/** Dos medidores sin topología declarada no se pueden sumar ni elegir arbitrariamente. */
function singleFlow(signals: Record<string, SignalDto>, side: 'inlet' | 'outlet'): number | null {
  const keys = flowKeys(signals, side);
  if (keys.length !== 1) return null;
  const value = numeric(signals[keys[0]]);
  return value !== null && value >= 0 ? value : null;
}

export function outletFlow(signals: Record<string, SignalDto>): number | null {
  return singleFlow(signals, 'outlet');
}

export function inletFlow(signals: Record<string, SignalDto>): number | null {
  return singleFlow(signals, 'inlet');
}

export function horasHasta(areaM2: number | null, desdeM: number, hastaM: number, caudalLps: number): number | null {
  if (![desdeM, hastaM, caudalLps].every(Number.isFinite)) return null;
  if (desdeM <= hastaM) return 0;
  if (areaM2 === null || !Number.isFinite(areaM2) || areaM2 <= 0 || caudalLps <= 0) return null;
  return areaM2 * (desdeM - hastaM) / (caudalLps * LPS_A_M3H);
}

/** Reevalúa el stock con el caudal estabilizado, sin congelar nivel ni volumen. */
export function actualizarCaudal(t: AutonomiaTanque, caudalLps: number): AutonomiaTanque {
  if (t.limitacion) return {
    ...t, caudalLps,
    horasHasta0: t.levelM === 0 && t.volumeM3 === 0 ? 0 : null,
    horasHasta50: t.maxM > 0 && t.levelM <= t.maxM * FRACCION_CRITICA ? 0 : null,
    horasHastaReserva: t.reservaM !== null && t.levelM <= t.reservaM ? 0 : null,
  };
  const caudalValido = Number.isFinite(caudalLps) && caudalLps > 0;
  return {
    ...t, caudalLps,
    // Para vaciado total basta el volumen medido, sin extrapolar geometría ni conocer opMax.
    horasHasta0: caudalValido && t.volumeM3 !== null ? t.volumeM3 / (caudalLps * LPS_A_M3H) : null,
    horasHasta50: t.maxM > 0 ? horasHasta(t.areaM2, t.levelM, t.maxM * FRACCION_CRITICA, caudalLps) : null,
    horasHastaReserva: t.reservaM !== null ? horasHasta(t.areaM2, t.levelM, t.reservaM, caudalLps) : null,
  };
}

/**
 * Reúne stock y reserva, sin atribuir al tanque el balance de caudales de la planta.
 * El mapping no declara conexión hidráulica: solo una tendencia propia habilita duraciones.
 * Para reserva se aproxima sección constante V/h; no hay curva de aforo.
 */
export function analizarAutonomia(snapshot: PlantSnapshotDto, caudalProyeccionLps: number | null): AutonomiaTanque[] {
  if (snapshot.pending || snapshot.liveness.state === 'frozen' || snapshot.bridgeStatus !== 'Connected') return [];
  const salida = outletFlow(snapshot.signals);
  const promedioValido = caudalProyeccionLps !== null && Number.isFinite(caudalProyeccionLps) && caudalProyeccionLps > 0;
  const origen: OrigenCaudal = promedioValido ? 'proyeccion_24h' : 'proyeccion_actual';
  const caudalLps = promedioValido ? caudalProyeccionLps! : salida ?? 0;
  const levels = Object.entries(snapshot.signals).filter(([key]) => /^(tank\d+|sanAntonioTank|quijoteTank)Level$/.test(key));
  const multipleFlows = flowKeys(snapshot.signals, 'outlet').length > 1 || flowKeys(snapshot.signals, 'inlet').length > 1;
  // El mapping no vincula ningún tanque a un caudal: ni un único tanque prueba esa conexión.
  const limitacion: LimitacionAutonomia = levels.length > 1 ? 'multiple_tanks' : multipleFlows ? 'multiple_flows' : 'unmapped_flow';

  return levels.flatMap(([key, signal]) => {
    const tankKey = key.slice(0, -'Level'.length);
    const tankN = Number(/^tank(\d+)Level$/.exec(key)?.[1] ?? 0);
    const levelM = numeric(signal);
    if (levelM === null || levelM < 0) return [];
    const maxM = typeof signal.opMax === 'number' && Number.isFinite(signal.opMax) && signal.opMax > 0 ? signal.opMax : 0;
    const volume = numeric(snapshot.signals[`${tankKey}Volume`]);
    const volumeM3 = volume !== null && volume >= 0 && (levelM > 0 || volume === 0) ? volume : null;
    const areaM2 = volumeM3 !== null && levelM > 0 ? volumeM3 / levelM : null;
    const minM = typeof signal.opMin === 'number' && Number.isFinite(signal.opMin) && signal.opMin >= 0 &&
      (maxM === 0 || signal.opMin < maxM) ? signal.opMin : null;
    const reservaM = minM ?? (maxM > 0 ? maxM * FRACCION_CRITICA : null);
    const reservaOrigen: ReservaOrigen | null = minM !== null ? 'op_min' : maxM > 0 ? '50_percent' : null;
    return [actualizarCaudal({
      tankN, tankKey, label: signal.label ?? (tankN ? `Tanque ${tankN}` : tankKey), levelM, maxM,
      pct: maxM > 0 ? levelM / maxM * 100 : null, areaM2, volumeM3, caudalLps, origen,
      horasHasta50: null, horasHasta0: null, horasHastaReserva: null, reservaM, reservaOrigen, limitacion,
    }, caudalLps)];
  });
}

export interface MuestraTanque {
  tsMs: number;
  nivelM: number;
  volumenM3: number | null;
}

/** Ventana corta local: umbrales de estimación, pendientes de calibración en campo. */
export const VENTANA_TENDENCIA_MS = 15 * 60_000;
export const MIN_TENDENCIA_MS = 5 * 60_000;
export const MAX_HUECO_TENDENCIA_MS = 3 * 60_000;
export const FRESCURA_TENDENCIA_MS = 2 * 60_000;

/** Ajuste por mínimos cuadrados con descenso >=1 % y R² >=0,8 para rechazar ruido. */
function pendienteDescenso(muestras: MuestraTanque[], value: (m: MuestraTanque) => number): number | null {
  const first = muestras[0];
  const last = muestras[muestras.length - 1];
  if (muestras.length < 3 || last.tsMs - first.tsMs < MIN_TENDENCIA_MS) return null;
  const ys = muestras.map(value);
  if (ys.some((y) => !Number.isFinite(y) || y < 0)) return null;
  const totalDrop = ys[0] - ys[ys.length - 1];
  if (totalDrop < Math.max(ys[0] * 0.01, 1e-6)) return null;
  // Una ventana antigua no demuestra que el tanque siga bajando ahora.
  const recent = ys.slice(-3);
  if (recent[0] - recent[2] <= Math.max(totalDrop * 0.05, 1e-6)) return null;
  if (recent.slice(1).some((y, i) => y - recent[i] > totalDrop * 0.05)) return null;
  const xs = muestras.map((m) => (m.tsMs - first.tsMs) / 3_600_000);
  const meanX = xs.reduce((a, x) => a + x, 0) / xs.length;
  const meanY = ys.reduce((a, y) => a + y, 0) / ys.length;
  const sxx = xs.reduce((a, x) => a + (x - meanX) ** 2, 0);
  const syy = ys.reduce((a, y) => a + (y - meanY) ** 2, 0);
  const sxy = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0);
  const slope = sxy / sxx;
  if (!Number.isFinite(slope) || slope >= 0 || syy <= 0 || sxy ** 2 / (sxx * syy) < 0.8) return null;
  return -slope;
}

/** La tendencia ya es neta: nunca se resta la entrada ni se atribuye una válvula al tanque. */
export function aplicarTendencia(t: AutonomiaTanque, historial: MuestraTanque[], ahoraMs: number): AutonomiaTanque {
  const muestras = historial.filter((m) => m.tsMs >= ahoraMs - VENTANA_TENDENCIA_MS && m.tsMs <= ahoraMs);
  if (muestras.length < 3 || ahoraMs - muestras[muestras.length - 1].tsMs > FRESCURA_TENDENCIA_MS) return t;
  for (let i = 1; i < muestras.length; i++) {
    const gap = muestras[i].tsMs - muestras[i - 1].tsMs;
    if (gap <= 0 || gap > MAX_HUECO_TENDENCIA_MS) return t;
  }
  const todasConVolumen = muestras.every((m) => m.volumenM3 !== null);
  const descensoM3h = todasConVolumen ? pendienteDescenso(muestras, (m) => m.volumenM3!) : null;
  const descensoMh = pendienteDescenso(muestras, (m) => m.nivelM);
  if (descensoM3h !== null && t.volumeM3 !== null) {
    if (descensoMh === null) return t;
    return actualizarCaudal({ ...t, origen: 'tendencia_volumen', limitacion: null }, descensoM3h / LPS_A_M3H);
  }
  // Si hay volumen válido pero contradice el descenso del nivel, no elegir el dato conveniente.
  if (todasConVolumen) return t;
  if (descensoMh === null) return t;
  const hasta = (objetivo: number) => Math.max(0, t.levelM - objetivo) / descensoMh;
  return {
    ...t, origen: 'tendencia_nivel', limitacion: null, caudalLps: 0,
    horasHasta0: hasta(0), horasHasta50: t.maxM > 0 ? hasta(t.maxM * FRACCION_CRITICA) : null,
    horasHastaReserva: t.reservaM !== null ? hasta(t.reservaM) : null,
  };
}

export function humanHoras(horas: number): string {
  const minutos = Math.max(0, Math.round(horas * 60));
  if (minutos < 60) return `${horas > 0 ? Math.max(1, minutos) : 0} min`;
  const h = Math.floor(minutos / 60);
  const min = minutos % 60;
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}
