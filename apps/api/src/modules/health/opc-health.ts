import type { AdapterDiagnostics } from '../../infrastructure/connectivity/ports/connectivity-adapter.port';

export interface OpcHealthReport {
  plcReachable: boolean;
  bridgeStatus: AdapterDiagnostics['bridgeStatus'];
  subscriptionAlive: boolean;
  lastNotificationAt: string | null;
  reconnectCount: number;
  notificationsTotal: number;
  droppedNotifications: number;
  deadLetterCount: number;
  buffersActive: number;
  buffersFaulted: number;
  publishLatencyMs: number | null;
}

export interface OpcHealthResult {
  report: OpcHealthReport;
  httpStatus: 200 | 503;
}

/** Función pura (testeable sin Nest): deriva salud industrial del diagnóstico del adapter. */
export function computeOpcHealth(diagnostics: AdapterDiagnostics, deadLetterTotal: number): OpcHealthResult {
  const isDegraded = diagnostics.bridgeStatus === 'Stale' || diagnostics.bridgeStatus === 'Faulted';
  const report: OpcHealthReport = {
    plcReachable: diagnostics.bridgeStatus === 'Connected' || diagnostics.bridgeStatus === 'Stale',
    bridgeStatus: diagnostics.bridgeStatus,
    subscriptionAlive: diagnostics.subscriptionCount > 0,
    lastNotificationAt: diagnostics.lastNotificationAt,
    reconnectCount: diagnostics.reconnectCount,
    notificationsTotal: diagnostics.notificationsTotal,
    droppedNotifications: diagnostics.droppedNotificationsTotal,
    deadLetterCount: deadLetterTotal,
    buffersActive: diagnostics.buffersActive,
    buffersFaulted: diagnostics.buffersFaulted,
    publishLatencyMs: diagnostics.lastNotificationLatencyMs,
  };
  return { report, httpStatus: isDegraded ? 503 : 200 };
}
