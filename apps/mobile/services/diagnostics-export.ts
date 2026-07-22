import { Platform, Share } from 'react-native';
import { classifyBridge, CONNECTION_CODES } from '@ptap/shared';
import {
  API_BASE_URL,
  type ConnectionEvent,
  type RouteCheckReport,
  type RouteHistoryResponse,
  type RouteProbe,
} from './api';

const CLASS_NOTE: Record<ReturnType<typeof classifyBridge>, string> = {
  ok: 'ok (sesión con el PLC establecida)',
  route: 'route (el servidor no alcanza el PLC — ruta de red)',
  master_no_data: 'master_no_data (hubo sesión y el PLC dejó de enviar datos)',
};

/** Código del catálogo (docs/CATALOGO_ERRORES.md) para cada clasificación del puente. */
const CLASS_CODE: Record<ReturnType<typeof classifyBridge>, string> = {
  ok: '—',
  route: CONNECTION_CODES.PLC_ROUTE,
  master_no_data: CONNECTION_CODES.PLC_NO_DATA,
};

const PROBE_LABEL: Record<RouteProbe['name'], string> = {
  internet: 'servidor → internet',
  ping: 'ping ICMP al host  ',
  plc: 'servidor → PLC     ',
};

/** Línea técnica de una sonda para el .txt (con el matiz timeout vs rechazo, que acota la causa). */
function probeLine(p: RouteProbe): string {
  const label = PROBE_LABEL[p.name];
  switch (p.outcome) {
    case 'ok':
      return `    ${label} : ${p.target}  → OK (${p.ms} ms)${p.name === 'ping' ? ' — el host está VIVO' : ''}`;
    case 'timeout':
      return `    ${label} : ${p.target}  → TIMEOUT (${p.ms} ms) — ${p.name === 'ping' ? 'sin eco ICMP' : 'paquetes sin respuesta (firewall que descarta / equipo apagado / IP incorrecta)'}`;
    case 'refused':
      return `    ${label} : ${p.target}  → RECHAZADA — host vivo, nada escucha en el puerto (servicio caído)`;
    case 'error':
      return `    ${label} : ${p.target}  → ERROR${p.detail ? ` ${p.detail}` : ''}`;
  }
}

/**
 * Sección del registro continuo (muestras del servidor cada 5 min). Para que el .txt sea legible
 * no se listan las ~288 muestras: va el resumen + solo las muestras donde el veredicto CAMBIÓ
 * (los momentos de corte/recuperación, que es lo que un técnico busca).
 */
function historyLines(history: RouteHistoryResponse): string[] {
  const { summary, samples } = history;
  if (summary.samples === 0) {
    return ['  (aún sin muestras — el servidor toma una prueba automática cada hora en punto)'];
  }
  const lines = [
    `  Ventana            : últimas ${summary.windowHours} h (${summary.oldestAt} → ${summary.newestAt})`,
    `  Muestras           : ${summary.samples} · PLC alcanzable en ${summary.plcOk} (${summary.uptimePct}%)`,
    `  Corte vigente desde: ${summary.downSince ?? '(no hay corte vigente)'}`,
    '  Cambios de veredicto en la ventana (cronológico):',
  ];
  // `samples` llega más reciente primero → recorrer al revés para narrarlo en orden temporal.
  let previo: string | null = null;
  let cambios = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    const code = s.detail?.code ?? '(n/d)';
    if (code === previo) continue;
    previo = code;
    cambios++;
    const probes = s.detail?.probes
      ? Object.entries(s.detail.probes)
          .map(([name, p]) => `${name}=${p.outcome}:${p.ms}ms`)
          .join(' · ')
      : '(sin sondas)';
    lines.push(`    [${s.at}] ${code === '—' ? 'RUTA OK' : code} · puente ${s.detail?.bridge ?? '?'} · ${probes}`);
  }
  if (cambios === 1) lines.push('    (sin cambios: el estado se mantuvo igual toda la ventana)');
  return lines;
}

/**
 * Arma el informe TÉCNICO de conexión: espaciado y legible para un programador, con códigos y
 * el `reason` crudo, MÁS la prueba de ruta en vivo (sondas con latencia, IP objetivo, IP pública
 * del servidor para identificar al proveedor, reintentos del puente). Es lo que el administrador
 * exporta y envía cuando escala una avería.
 * (La sección de Ajustes muestra lo mismo en lenguaje llano; esto es la versión técnica.)
 */
export function buildDiagnosticsReport(
  events: ConnectionEvent[],
  routeCheck: RouteCheckReport | null = null,
  history: RouteHistoryResponse | null = null,
): string {
  const lines: string[] = [
    'INFORME DE DIAGNÓSTICO DE CONEXIÓN — Monitor PTAP',
    `Generado:      ${new Date().toISOString()}`,
    `Servidor API:  ${API_BASE_URL}`,
    `Eventos:       ${events.length} (más reciente primero)`,
    'Códigos:       ver docs/CATALOGO_ERRORES.md (PLC-01 = ruta; PLC-02 = el PLC dejó de enviar;',
    '               PLC-11 = puerto del PLC rechaza; SRV-07 = el servidor sin salida a internet)',
    '',
    '='.repeat(72),
    'PRUEBA DE RUTA EN VIVO',
    '='.repeat(72),
  ];

  if (routeCheck) {
    lines.push(
      `  Ejecutada          : ${routeCheck.at}`,
      `  Objetivo (PLC)     : ${routeCheck.target.host}:${routeCheck.target.port}  (${routeCheck.target.endpoint})`,
      `  IP pública servidor: ${routeCheck.serverPublicIp ?? '(no disponible)'}${routeCheck.serverPublicIp ? '  ← con esta IP se identifica al proveedor del servidor (whois)' : ''}`,
      '  Sondas TCP (sin OPC UA):',
      ...routeCheck.probes.map(probeLine),
      `  VEREDICTO [${routeCheck.verdict.code}] (${routeCheck.verdict.where}):`,
      `    ${routeCheck.verdict.message}`,
      `  Puente OPC UA      : ${routeCheck.bridge.status} · reconexiones: ${routeCheck.bridge.reconnectCount} · último dato: ${routeCheck.bridge.lastNotificationAt ?? '(nunca en esta sesión)'}`,
    );
  } else {
    lines.push('  (no ejecutada — usa "Probar ruta ahora" en Ajustes antes de exportar para incluirla)');
  }

  lines.push('', '='.repeat(72), 'REGISTRO INTERNO DE LA RUTA (prueba automática cada hora en punto + manuales)', '='.repeat(72));
  if (history) {
    lines.push(...historyLines(history));
  } else {
    lines.push('  (no disponible — el servidor no respondió el historial al exportar)');
  }

  lines.push('', '='.repeat(72), 'HISTORIAL DE TRANSICIONES DEL PUENTE', '='.repeat(72), '');

  if (events.length === 0) {
    lines.push('(sin eventos de conexión registrados)');
  }

  for (const ev of events) {
    const status = ev.detail?.status ?? '(desconocido)';
    const reason = ev.detail?.reason ?? '(sin detalle)';
    const clase = ev.detail?.status ? classifyBridge(ev.detail.status) : null;
    lines.push(
      `[${ev.at}]  ${ev.eventType}`,
      `    codigo        : ${clase ? CLASS_CODE[clase] : '(n/d)'}`,
      `    bridgeStatus  : ${status}`,
      `    clasificacion : ${clase ? CLASS_NOTE[clase] : '(n/d)'}`,
      `    reason        : ${reason}`,
      '',
    );
  }

  return lines.join('\n');
}

/**
 * Exporta el informe. En web descarga un .txt (destino de la demo); en nativo lo comparte como
 * texto con el diálogo del sistema (sin dependencias extra). Devuelve false si no se pudo.
 */
export async function exportDiagnosticsReport(
  events: ConnectionEvent[],
  routeCheck: RouteCheckReport | null = null,
  history: RouteHistoryResponse | null = null,
): Promise<boolean> {
  const content = buildDiagnosticsReport(events, routeCheck, history);
  const filename = `diagnostico-conexion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;

  if (Platform.OS === 'web') {
    // Descarga estándar del navegador: Blob + enlace temporal.
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  // Nativo: compartir el texto con el diálogo del sistema (built-in, sin expo-sharing).
  try {
    await Share.share({ title: filename, message: content });
    return true;
  } catch {
    return false;
  }
}
