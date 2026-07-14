import type { BridgeStatus } from '../ports/connectivity-adapter.port';
import type { ExtractedSignal } from './mapping.engine';
import type { LivenessDto, PlantSnapshotDto, SignalDto } from './plant-snapshot.dto';
import { evaluateQuality } from './quality.evaluator';
import type { DeadLetterBuffer } from './dead-letter.buffer';

export interface SnapshotInput {
  plantId: string;
  displayName: string;
  protocolVersion: string;
  dtoVersion: string;
  sequence: number;
  bridgeStatus: BridgeStatus;
  liveness: LivenessDto;
  extracted: ExtractedSignal[];
  deadLetter: DeadLetterBuffer;
}

/**
 * Snapshot Builder (PASO 3.6): ensambla el DTO por planta aplicando QualityService a cada
 * señal. NUNCA asciende un `inferred` a `confirmed` (el confidence viene tal cual del
 * mapping). Los valores no-finitos se serializan como null (JSON-safe) y quedan usable:false.
 */
export function buildSnapshot(input: SnapshotInput): PlantSnapshotDto {
  const signals: Record<string, SignalDto> = {};

  for (const ex of input.extracted) {
    const verdict = evaluateQuality({
      value: ex.value,
      quality: ex.quality,
      min: ex.min,
      max: ex.max,
      livenessState: input.liveness.state,
    });

    // Dead-letter de anomalías de VALOR (las estructurales ya se registraron en el engine).
    if (!ex.structurallyBroken && verdict.reason === 'INVALID_NUMBER') {
      input.deadLetter.record('INVALID_NUMBER', input.plantId, ex.domainKey, `valor no finito: ${String(ex.value)}`);
    }

    const finite = typeof ex.value === 'number' ? Number.isFinite(ex.value) : true;
    const dto: SignalDto = {
      value: finite ? ex.value : null, // JSON-safe: NaN/Infinity → null
      unit: ex.unit,
      quality: ex.quality,
      usable: verdict.usable,
      mappingStatus: ex.mappingStatus,
      confidence: ex.confidence, // el Builder nunca sube inferred → confirmed
      label: ex.label,
      ts: ex.sourceTimestamp,
    };
    if (verdict.reason) dto.reason = verdict.reason;
    signals[ex.domainKey] = dto;
  }

  return {
    plantId: input.plantId,
    displayName: input.displayName,
    sequence: input.sequence,
    protocolVersion: input.protocolVersion,
    dtoVersion: input.dtoVersion,
    bridgeStatus: input.bridgeStatus,
    liveness: input.liveness,
    signals,
  };
}
