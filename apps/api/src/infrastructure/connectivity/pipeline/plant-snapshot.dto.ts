import type { BridgeStatus, OpcQuality } from '../ports/connectivity-adapter.port';

/**
 * DTO por planta (Fase 2 acotada). Contrato hacia REST + Socket.IO + frontend.
 * Compatible con el futuro SnapshotBuilder completo: solo se AÑADEN campos.
 * El frontend NUNCA recibe arrays crudos (regla 4): solo estas señales de dominio.
 */

/**
 * Frescura de datos de la planta. TRES estados, y la diferencia entre los dos últimos es la
 * salud de la SESIÓN, no el reloj:
 *   live    → llegó un cambio de valor hace poco.
 *   stable  → la sesión está sana pero los valores no se mueven. Es NORMAL: un tanque a nivel
 *             constante o una presión sostenida no son una avería. Sus datos son VÁLIDOS.
 *   frozen  → perdimos la fuente (puente caído/reconectando). No sabemos qué pasa en la planta,
 *             así que los datos dejan de ser fiables.
 *
 * Antes había 4 estados y `stale` se decidía solo por tiempo sin cambios: una planta operando
 * en régimen estable se marcaba congelada Y sus señales se invalidaban. El heartbeat del puente
 * es lo que permite distinguir "no se mueve" de "no llega".
 */
export type LivenessState = 'live' | 'stable' | 'frozen';

/** Razón por la que una señal no es usable (QualityService). */
export type UnusableReason = 'BAD_QUALITY' | 'INVALID_NUMBER' | 'BRIDGE_STALE';

export interface SignalDto {
  value: number | boolean | null;
  unit: string | null;
  quality: OpcQuality;
  usable: boolean;
  reason?: UnusableReason;
  /** true si el valor cae fuera de [min, max] del mapping. Informativo/alerta — el valor
   * SIGUE mostrándose (nunca se oculta por esto solo). */
  outOfRange?: boolean;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: 'confirmed' | 'inferred' | 'estimated';
  label: string | null;
  ts: string | null; // SourceTimestamp del PLC (regla 7)
  /** Rango operativo/normativo entregado por el operador. El front lo MUESTRA junto al valor (Mín/Máx) para que el cliente interprete la lectura, como en la app original. */
  opMin?: number;
  opMax?: number;
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
