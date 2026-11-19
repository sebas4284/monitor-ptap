import { hasRangeAnomaly, type SignalDto, type TankAutonomyDto } from '@ptap/shared';
import Colors from '../constants/colors';
import { directionFor } from './signal-kind';
import type { TankView } from './tanks';

/**
 * Umbrales del aviso `tank_autonomy`, COPIADOS de
 * apps/api/src/modules/notifications/tank-autonomy.analyzer.ts (FRACCION_CRITICA, AUTONOMIA_CRITICA_H),
 * que usa `TankAutonomyDetector.avisoDe`. La tarjeta debe ponerse amarilla exactamente cuando el
 * backend avisaría.
 * shortcut: copia manual de dos constantes del backend; moverlas a @ptap/shared (pendiente de backend).
 */
export const FRACCION_CRITICA = 0.5;
export const AUTONOMIA_CRITICA_H = 1;

const B = Colors.brand;

/**
 * Reglas de presentación de las tarjetas del tablero, aparte de los componentes para poder
 * probarlas sin React Native.
 */

/** Rojo SOLO para fuera de rango. Mismo criterio que la campana (`hasRangeAnomaly` de @ptap/shared):
 *  incluye el rango OPERATIVO (opMin/opMax), no solo el `outOfRange` físico del backend. */
export function isAnomalous(signal: SignalDto): boolean {
  return hasRangeAnomaly(signal);
}

export interface DirectionLook {
  label: 'Entrada' | 'Salida';
  /** Nombre de Ionicons. */
  icon: 'arrow-forward' | 'arrow-back';
  color: string;
}

/** Entrada y salida se distinguen con icono + etiqueta + dos azules. El verde queda para "OK". */
export function directionLook(domainKey: string): DirectionLook | null {
  const d = directionFor(domainKey);
  if (d === 'inlet') return { label: 'Entrada', icon: 'arrow-forward', color: B.inflow };
  if (d === 'outlet') return { label: 'Salida', icon: 'arrow-back', color: B.outflow };
  return null;
}

export type TankFillKind = 'unconfirmed' | 'normal' | 'overflow';

export interface TankFill {
  kind: TankFillKind;
  /** Altura del agua dibujada, 0–100. null = no se dibuja nivel (no se inventa). */
  drawPct: number | null;
}

/**
 * Cómo dibujar el tanque. `percentage` null = la planta no ha confirmado la capacidad: no hay
 * nivel que dibujar. Por encima de 100 % es rebose: se dibuja lleno y se dice que rebosa.
 */
export function tankFill(percentage: number | null): TankFill {
  if (percentage === null || !Number.isFinite(percentage)) return { kind: 'unconfirmed', drawPct: null };
  if (percentage > 100) return { kind: 'overflow', drawPct: 100 };
  return { kind: 'normal', drawPct: Math.max(0, percentage) };
}

/**
 * Autonomía baja (amarillo), con la MISMA regla que `TankAutonomyDetector.avisoDe`:
 *  - ya está bajo el 50 % (`hoursTo50 === 0`), o
 *  - se está vaciando de verdad (`vaciado_real`) y le queda ≤ AUTONOMIA_CRITICA_H.
 * Una `proyeccion_24h` por encima del 50 % NO es baja: es un supuesto, no una cuenta atrás.
 */
export function isAutonomyLow(a: TankAutonomyDto | null): boolean {
  if (!a) return false;
  if (a.hoursTo50 === 0) return true;
  return a.basis === 'vaciado_real' && a.hoursTo0 !== null && a.hoursTo0 <= AUTONOMIA_CRITICA_H;
}

/** Horas y minutos como los diría un operador: «3 h 20 min», «45 min». */
export function humanHoras(horas: number): string {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`;
  const h = Math.floor(horas);
  const min = Math.round((horas - h) * 60);
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

export interface AutonomyLook {
  /** "Autonomía" (cuenta atrás real) o "Si cierras la entrada" (supuesto). */
  label: string;
  texto: string;
  /** De dónde sale el número. */
  pie: string;
  low: boolean;
}

/**
 * Texto de la autonomía, o `null` si no hay nada honesto que decir. El número lo calcula el BACKEND;
 * aquí solo se redacta. Con la entrada cerrada es una cuenta atrás real; con la entrada abierta es
 * un supuesto («si cerraras ahora») con el consumo medio del día, y se rotula como tal.
 */
export function autonomyLook(a: TankAutonomyDto | null): AutonomyLook | null {
  if (!a || a.hoursTo0 === null) return null;
  const pct = Math.round(FRACCION_CRITICA * 100);
  // Punto medio y no coma: «15 h 58 min, 7 h 58 min» con coma se leería como una sola cifra.
  const hasta50 =
    a.hoursTo50 === 0
      ? ` · ya bajo el ${pct} %`
      : a.hoursTo50 !== null
        ? ` · ${humanHoras(a.hoursTo50)} al ${pct} %`
        : '';
  const real = a.basis === 'vaciado_real';
  return {
    label: real ? 'Autonomía' : 'Si cierras la entrada',
    texto: `${humanHoras(a.hoursTo0)}${hasta50}`,
    pie: real
      ? `Entrada cerrada · vaciándose a ${a.flowLps.toFixed(1)} l/s`
      : `Proyección con el consumo medio del día (${a.flowLps.toFixed(1)} l/s)`,
    low: isAutonomyLow(a),
  };
}

/** Estado de una tarjeta de señal. El destello se dispara al CAMBIAR de estado, no de valor. */
export type CardState = 'ok' | 'out_of_range' | 'no_data';

export function signalState(signal: SignalDto): CardState {
  if (signal.value === null) return 'no_data';
  return isAnomalous(signal) ? 'out_of_range' : 'ok';
}

export type TankState = CardState | 'overflow' | 'autonomy_low';

export function tankState(tank: TankView): TankState {
  if (tank.levelM === null && tank.volumeM3 === null) return 'no_data';
  if (tank.percentage !== null && tank.percentage > 100) return 'overflow';
  if (tank.outOfRange || (tank.levelM !== null && tank.levelM < 0)) return 'out_of_range';
  if (isAutonomyLow(tank.autonomy)) return 'autonomy_low';
  return 'ok';
}

/** Formato numérico es-CO, igual que las tarjetas. */
const fmt = (n: number): string =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Franja roja del tablero: la PRIMERA señal con `hasRangeAnomaly`, su valor y el límite que rompe,
 * y cuántas más hay. `null` si ninguna está fuera de rango.
 */
export function anomalyBanner(
  entries: [string, SignalDto][],
): { text: string; more: number } | null {
  const bad = entries.filter(([, s]) => isAnomalous(s));
  if (bad.length === 0) return null;
  const [key, s] = bad[0];
  const name = s.label ?? key;
  const unit = s.unit ? ` ${s.unit}` : '';
  let limit = 'fuera de su rango válido';
  if (typeof s.value === 'number') {
    if (typeof s.opMax === 'number' && s.value > s.opMax) limit = `máximo ${fmt(s.opMax)}`;
    else if (typeof s.opMin === 'number' && s.value < s.opMin) limit = `mínimo ${fmt(s.opMin)}`;
  }
  const value = typeof s.value === 'number' ? `${fmt(s.value)}${unit}, ` : '';
  return { text: `${name} fuera de rango: ${value}${limit}`, more: bad.length - 1 };
}

/**
 * ¿Destellar la tarjeta? Solo cuando su ESTADO cambió respecto al último pintado (entra o sale del
 * rango, pasa a "sin datos"…), la planta no está congelada y no se pidió reducir movimiento. Un
 * simple cambio de valor no destella. El número nunca se anima.
 */
export function shouldFlash(
  previous: unknown,
  next: unknown,
  frozen: boolean,
  reduceMotion: boolean | null,
): boolean {
  return previous !== undefined && previous !== next && !frozen && reduceMotion === false;
}
