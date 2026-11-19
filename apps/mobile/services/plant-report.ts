import { hasRangeAnomaly } from '@ptap/shared';
import type { PlantReport } from './api';

export interface ReportItem {
  label: string;
  state: 'ok' | 'warning' | 'error' | 'unknown';
  at: string | null;
  detail: string;
}

/** Misma evidencia y mismas horas en pantalla y en el archivo exportado. */
export function plantReportSections(report: PlantReport): { title: string; items: ReportItem[] }[] {
  const stale = report.liveness?.state === 'frozen' || report.bridge.status !== 'Connected';
  const route = report.network.latest;
  const probes = route?.detail?.probes;
  const labels: Record<string, string> = {
    internet: 'Servidor → internet', ping: 'Ping al host del PLC',
    plc: 'Servidor → PLC', control: 'Otro puerto del mismo host',
  };
  const network: ReportItem[] = probes ? Object.entries(probes).map(([name, probe]) => ({
    label: labels[name] ?? name,
    state: probe.outcome === 'ok' || (name === 'control' && probe.outcome === 'refused') ? 'ok' : 'warning',
    at: route?.at ?? null,
    detail: `${probe.outcome} · ${probe.ms} ms${name === 'plc' && route?.detail?.target ? ` · ${route.detail.target}` : ''}`,
  })) : [{ label: 'Prueba de ruta', state: 'unknown', at: null, detail: 'Sin pruebas de red registradas.' }];
  if (route?.detail?.code) network.push({
    label: 'Veredicto de red', state: route.detail.code === '—' ? 'ok' : 'warning', at: route.at,
    detail: `${route.detail.code} · ${route.detail.where ?? 'ubicación sin determinar'}`,
  });
  return [
    { title: 'Red', items: network },
    { title: 'Puente', items: [
      { label: 'Conexión global', state: report.bridge.status === 'Connected' ? 'ok' : 'warning',
        at: report.bridge.at, detail: `${report.bridge.status} · ${report.bridge.diagnostics.reconnectCount} reconexiones · hora de última notificación` },
      { label: report.displayName, state: report.plant?.lastFrameAt ? (stale || report.plant.buffersFaulted ? 'warning' : 'ok') : 'unknown',
        at: report.plant?.lastFrameAt ?? null,
        detail: report.plant ? `${report.plant.buffersFaulted} de ${report.plant.buffersTotal} buffers con fallo · último frame` : 'Sin frames registrados para esta planta.' },
    ] },
    { title: 'Buffers', items: report.buffers.map((buffer) => ({
      label: buffer.browseName, state: buffer.faulted ? 'error' : !buffer.sourceTimestamp || !buffer.resolved ? 'unknown' : stale ? 'warning' : 'ok',
      at: buffer.sourceTimestamp,
      detail: `${buffer.channel} · ${buffer.faulted ? 'con fallo' : buffer.resolved ? 'NodeId resuelto' : 'NodeId sin resolver'}${buffer.reason ? ` · ${buffer.reason}` : ''}${stale ? ' · dato en cache: planta congelada o puente sin conexión' : ''}`,
    })) },
    { title: 'Señales', items: report.signals.map((signal) => ({
      label: signal.label ?? signal.domainKey,
      state: !signal.usable || signal.value === null || stale || hasRangeAnomaly(signal) ? 'warning' : 'unknown',
      at: signal.ts,
      detail: `${signal.domainKey} · ${signal.value === null ? 'sin valor' : String(signal.value)}${signal.unit ? ` ${signal.unit}` : ''} · ${signal.quality}${!signal.usable ? ` · no usable: ${signal.reason ?? 'sin motivo informado'}` : ''}${hasRangeAnomaly(signal) ? ' · fuera de rango' : ''}${stale ? ` · dato en cache: planta ${report.liveness?.state ?? 'sin estado'}, puente ${report.bridge.status}` : ' · frescura de esta señal sin determinar'} · hora del dato PLC`,
    })) },
    { title: 'Anomalías', items: report.anomalies.map((anomaly) => ({
      label: `${anomaly.type} · ${anomaly.domainKey}`, state: 'warning', at: anomaly.at, detail: anomaly.detail,
    })) },
  ];
}
