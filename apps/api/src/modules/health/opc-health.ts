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

/**
 * Función pura (testeable sin Nest): deriva salud industrial del diagnóstico del adapter.
 *
 * Degradado (503) = el puente NO está `Connected`. Solo `Connected` (sesión viva, validada por el
 * heartbeat) es sano; `Connecting`/`Disconnected`/`Recovering`/`Stale`/`Faulted` significan que el
 * enlace al PLC no está arriba y un monitor debe poder detectarlo por el código de estado. Antes
 * solo `Stale`/`Faulted` daban 503, así que un corte atascado en `Connecting` (el caso real) se
 * reportaba 200 "sano".
 *
 * El estado es INSTANTÁNEO a propósito: el "alertar solo tras X minutos" es la regla del monitor
 * (uptime-monitor con umbral de N fallos, o Alertmanager con `for: 5m` sobre `opc_bridge_status`),
 * no algo quemado aquí — así ops ajusta el debounce sin redeploy. Ver docs/INCIDENTE_CONEXION_PLC.md.
 */
export function computeOpcHealth(diagnostics: AdapterDiagnostics, deadLetterTotal: number): OpcHealthResult {
  const isDegraded = diagnostics.bridgeStatus !== 'Connected';
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
