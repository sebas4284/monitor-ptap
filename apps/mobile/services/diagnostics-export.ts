import { Platform, Share } from 'react-native';
import { classifyBridge } from '@ptap/shared';
import { API_BASE_URL, type ConnectionEvent } from './api';

const CLASS_NOTE: Record<ReturnType<typeof classifyBridge>, string> = {
  ok: 'ok (sesión con el PLC establecida)',
  route: 'route (el servidor no alcanza el PLC — ruta de red)',
  master_no_data: 'master_no_data (hubo sesión y el PLC dejó de enviar datos)',
};

/**
 * Arma el informe TÉCNICO de conexión: espaciado y legible para un programador, con códigos y
 * el `reason` crudo. Es lo que el administrador exporta y envía cuando escala una avería.
 * (La sección de Ajustes muestra lo mismo en lenguaje llano; esto es la versión técnica.)
 */
export function buildDiagnosticsReport(events: ConnectionEvent[]): string {
  const lines: string[] = [
    'INFORME DE DIAGNÓSTICO DE CONEXIÓN — Monitor PTAP',
    `Generado:      ${new Date().toISOString()}`,
    `Servidor API:  ${API_BASE_URL}`,
    `Eventos:       ${events.length} (más reciente primero)`,
    '',
    '='.repeat(72),
    '',
  ];

  if (events.length === 0) {
    lines.push('(sin eventos de conexión registrados)');
  }

  for (const ev of events) {
    const status = ev.detail?.status ?? '(desconocido)';
    const reason = ev.detail?.reason ?? '(sin detalle)';
    const clasificacion = ev.detail?.status ? CLASS_NOTE[classifyBridge(ev.detail.status)] : '(n/d)';
    lines.push(
      `[${ev.at}]  ${ev.eventType}`,
      `    bridgeStatus  : ${status}`,
      `    clasificacion : ${clasificacion}`,
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
export async function exportDiagnosticsReport(events: ConnectionEvent[]): Promise<boolean> {
  const content = buildDiagnosticsReport(events);
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
