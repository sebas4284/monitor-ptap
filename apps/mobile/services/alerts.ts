import type { PlantSnapshotDto } from './api';

/**
 * Alertas REALES derivadas del snapshot (cero mocks). Una señal genera alerta cuando su valor
 * numérico sale de un rango que el propio dato define:
 *   - `outOfRange` (fuera del rango FÍSICO válido [min,max] del mapping) → CRÍTICA.
 *   - valor por debajo de `opMin` o por encima de `opMax` (rango OPERATIVO que entregó el
 *     operador) → ADVERTENCIA. Es exactamente la "futura alarma" que el resto del código anticipa.
 *
 * Con datos CONGELADOS (liveness `frozen`, sin conexión con el PLC) NO se generan alertas de rango:
 * los valores son viejos y alarmar sobre ellos sería mentir. Ese corte ya lo avisan el banner de
 * conexión y el LiveBadge, no se duplica aquí.
 */
export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  /** Estable por (planta, señal, tipo): permite descartar y que reaparezca solo si vuelve a ocurrir. */
  id: string;
  plantId: string;
  domainKey: string;
  label: string;
  severity: AlertSeverity;
  message: string;
  value: number;
  unit: string | null;
  ts: string | null;
}

export function deriveAlerts(snapshot: PlantSnapshotDto | undefined): Alert[] {
  if (!snapshot || snapshot.liveness.state === 'frozen') return [];

  const alerts: Alert[] = [];
  for (const [domainKey, s] of Object.entries(snapshot.signals)) {
    if (typeof s.value !== 'number') continue;
    const label = s.label ?? domainKey;
    const base = { plantId: snapshot.plantId, domainKey, label, value: s.value, unit: s.unit, ts: s.ts };

    if (s.outOfRange) {
      alerts.push({ ...base, id: `${snapshot.plantId}:${domainKey}:range`, severity: 'critical', message: 'Fuera del rango físico válido' });
      continue; // una señal fuera del rango físico no necesita además la alerta operativa
    }

    const below = typeof s.opMin === 'number' && s.value < s.opMin;
    const above = typeof s.opMax === 'number' && s.value > s.opMax;
    if (below || above) {
      const limit = (below ? s.opMin : s.opMax) as number;
      alerts.push({
        ...base,
        id: `${snapshot.plantId}:${domainKey}:op`,
        severity: 'warning',
        message: `${below ? 'Por debajo del mínimo' : 'Por encima del máximo'} operativo (${limit.toFixed(2)}${s.unit ? ' ' + s.unit : ''})`,
      });
    }
  }

  // Críticas primero; dentro de cada nivel, por etiqueta (orden estable).
  return alerts.sort((a, b) =>
    a.severity === b.severity ? a.label.localeCompare(b.label) : a.severity === 'critical' ? -1 : 1,
  );
}
