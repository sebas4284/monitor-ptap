import type { OpcQuality } from '../ports/connectivity-adapter.port';
import type { LivenessState, UnusableReason } from './plant-snapshot.dto';

export interface QualityVerdict {
  usable: boolean;
  reason?: UnusableReason;
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
 * así NO ser usable (caudal negativo, fuera de rango, o el sitio está congelado).
 * Orden de rechazo, del más fundamental al derivado:
 *   1. StatusCode != Good           → BAD_QUALITY
 *   2. NaN / Infinity               → INVALID_NUMBER
 *   3. fuera de [min, max]          → OUT_OF_RANGE
 *   4. liveness stale/unknown       → BRIDGE_STALE (el valor puede ser viejo)
 */
export function evaluateQuality(input: QualityInput): QualityVerdict {
  if (input.quality !== 'Good') return { usable: false, reason: 'BAD_QUALITY' };

  if (typeof input.value === 'number' && !Number.isFinite(input.value)) {
    return { usable: false, reason: 'INVALID_NUMBER' };
  }

  if (typeof input.value === 'number') {
    if (input.min !== null && input.value < input.min) return { usable: false, reason: 'OUT_OF_RANGE' };
    if (input.max !== null && input.value > input.max) return { usable: false, reason: 'OUT_OF_RANGE' };
  }

  if (input.livenessState === 'stale' || input.livenessState === 'unknown') {
    return { usable: false, reason: 'BRIDGE_STALE' };
  }

  return { usable: true };
}
