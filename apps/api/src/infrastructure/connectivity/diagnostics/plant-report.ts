import type { AuditEventRow } from '../../audit/audit-log.service';
import type { AdapterDiagnostics, BufferHealth } from '../ports/connectivity-adapter.port';
import type { PlantSnapshotDto } from '../pipeline/plant-snapshot.dto';
import type { DeadLetterEntry } from '../pipeline/dead-letter.buffer';
import type { BufferFreshness } from '../opcua/freshness.service';

export interface PlantReportInput {
  plantId: string;
  displayName: string;
  at: string;
  diagnostics: AdapterDiagnostics;
  buffers: BufferHealth[];
  snapshot: PlantSnapshotDto | null;
  bufferSourceTimestamps?: Record<string, string | null>;
  anomalies: DeadLetterEntry[];
  routeEvents: AuditEventRow[];
  connectionEvents: AuditEventRow[];
  freshness?: BufferFreshness[];
}

/** Composición sin reloj, red ni mutación; las horas del dato nunca se inventan. */
export function buildPlantReport(input: PlantReportInput) {
  const { plantId, snapshot, diagnostics } = input;
  return {
    plantId, displayName: input.displayName, at: input.at,
    network: { scope: 'global', latest: input.routeEvents[0] ?? null, history: input.routeEvents },
    bridge: { scope: 'global', status: diagnostics.bridgeStatus, at: diagnostics.lastNotificationAt, diagnostics, history: input.connectionEvents },
    plant: diagnostics.perPlant.find((p) => p.plantId === plantId) ?? null,
    buffers: input.buffers.filter((b) => b.plantId === plantId).map((b) => ({ ...b, sourceTimestamp: input.bufferSourceTimestamps?.[b.browseName] ?? null })),
    liveness: snapshot?.liveness ?? null,
    signals: Object.entries(snapshot?.signals ?? {}).map(([domainKey, signal]) => ({ domainKey, ...signal })),
    anomalies: input.anomalies.filter((a) => a.plantId === plantId),
    freshness: input.freshness ?? null,
    deepProbe: input.freshness !== undefined,
  };
}
export type PlantReport = ReturnType<typeof buildPlantReport>;
