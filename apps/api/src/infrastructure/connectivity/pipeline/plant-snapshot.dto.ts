import type { BridgeStatus, OpcQuality } from '../ports/connectivity-adapter.port';

/**
 * DTO por planta (Fase 2 acotada). Contrato hacia REST + Socket.IO + frontend.
 * Compatible con el futuro SnapshotBuilder completo: solo se AÑADEN campos.
 * El frontend NUNCA recibe arrays crudos (regla 4): solo estas señales de dominio.
 */

/** Liveness por frescura de datos (4 estados; `unknown` es obligatorio, regla de honestidad). */
export type LivenessState = 'live' | 'idle' | 'stale' | 'unknown';

/** Razón por la que una señal no es usable (QualityService). */
export type UnusableReason = 'BAD_QUALITY' | 'INVALID_NUMBER' | 'OUT_OF_RANGE' | 'BRIDGE_STALE';

export interface SignalDto {
  value: number | boolean | null;
  unit: string | null;
  quality: OpcQuality;
  usable: boolean;
  reason?: UnusableReason;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: 'confirmed' | 'inferred' | 'estimated';
  label: string | null;
  ts: string | null; // SourceTimestamp del PLC (regla 7)
}

export interface LivenessDto {
  state: LivenessState;
  lastChangeAt: string | null;
  windowSec: number;
}

export interface PlantSnapshotDto {
  plantId: string;
  displayName: string;
  sequence: number;
  protocolVersion: string;
  dtoVersion: string;
  bridgeStatus: BridgeStatus;
  liveness: LivenessDto;
  signals: Record<string, SignalDto>;
}

/** Cambio de liveness para el evento opc:liveness. */
export interface LivenessChange {
  plantId: string;
  state: LivenessState;
  lastChangeAt: string | null;
  windowSec: number;
}
