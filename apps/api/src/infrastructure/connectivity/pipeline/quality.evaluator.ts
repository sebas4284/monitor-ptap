import type { OpcQuality } from '../ports/connectivity-adapter.port';
import type { LivenessState, UnusableReason } from './plant-snapshot.dto';

export interface QualityVerdict {
  usable: boolean;
  reason?: UnusableReason;
  /** true si el valor numérico cae fuera de [min, max]. NO afecta `usable` — decisión de
   * producto: los límites son para alertar a futuro, no para ocultar la lectura real. */
  outOfRange?: boolean;
}

export interface QualityInput {
  value: number | boolean | null;
  quality: OpcQuality;
  min: number | null;
  max: number | null;
  livenessState: LivenessState;
}

/**
 * QualityService (PASO 3.5): decide `usable`. Un dato puede llegar Good del PLC y aun
 * así NO ser usable (valor no finito, o el sitio está congelado). Un valor fuera de
 * [min, max] SIGUE siendo usable — solo se marca `outOfRange` para que el frontend lo
 * destaque como aviso (futura alerta), nunca para ocultar el número.
 * Orden de rechazo, del más fundamental al derivado:
 *   1. StatusCode != Good           → BAD_QUALITY
 *   2. NaN / Infinity               → INVALID_NUMBER
 *   3. liveness stale/unknown       → BRIDGE_STALE (el valor puede ser viejo)
 */
export function evaluateQuality(input: QualityInput): QualityVerdict {
  if (input.quality !== 'Good') return { usable: false, reason: 'BAD_QUALITY' };

  if (typeof input.value === 'number' && !Number.isFinite(input.value)) {
    return { usable: false, reason: 'INVALID_NUMBER' };
  }

  let outOfRange = false;
  if (typeof input.value === 'number') {
    if (input.min !== null && input.value < input.min) outOfRange = true;
    if (input.max !== null && input.value > input.max) outOfRange = true;
  }

  if (input.livenessState === 'stale' || input.livenessState === 'unknown') {
    return { usable: false, reason: 'BRIDGE_STALE', outOfRange };
  }

  return { usable: true, outOfRange };
}
