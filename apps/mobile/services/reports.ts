import { Platform, Share } from 'react-native';
import { API_BASE_URL, getAuthToken, getJson, postJson } from './api';

/**
 * Cliente REAL de informes por métrica (CSV). Reemplaza el mock de reportes: la lista, el estado
 * y el archivo salen del backend. Generar y descargar exigen el permiso `export_data` (admin).
 */
export type ReportStatus = 'idle' | 'collecting' | 'ready';

export interface ReportInfo {
  metric: string;
  label: string;
  unit: string | null;
  status: ReportStatus;
  /** Muestras tomadas / total mientras `collecting`. */
  progress: number | null;
  total: number | null;
  /** ISO de la última generación completada, o null. */
  generatedAt: string | null;
  rows: number | null;
  nextAutoAt: string | null;
}

/** Métricas de la planta con el estado de su informe. */
export async function fetchReports(plantId: string): Promise<ReportInfo[]> {
  const body = await getJson<{ reports: ReportInfo[] }>(`/api/reports/${plantId}`);
  return body.reports;
}

/** Dispara la recolección (1 muestra/min por 1 h). Lanza si ya hay una en curso (409). */
export async function generateReport(plantId: string, metric: string): Promise<void> {
  await postJson(`/api/reports/${plantId}/${metric}/generate`, undefined);
}

/**
 * Descarga el CSV listo. El backend exige JWT, así que NO sirve un enlace directo: se pide con el
 * token y luego se guarda. En web se descarga un .csv; en nativo se comparte con el diálogo del
 * sistema. Devuelve false si no se pudo.
 */
export async function downloadReport(plantId: string, metric: string): Promise<boolean> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE_URL}/api/reports/${plantId}/${metric}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) return false;

  const filename = `informe-${plantId}-${metric}.csv`;
  const content = await res.text();

  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
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
  try {
    await Share.share({ title: filename, message: content });
    return true;
  } catch {
    return false;
  }
}
