import type { TankAutonomyDto } from './api';

export function autonomyDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return 'Sin estimación';
  if (hours === 0) return '0 min';
  const minutes = Math.max(1, Math.round(hours * 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function tankAutonomyText(a: TankAutonomyDto | null, frozen = false) {
  if (frozen) return { label: 'Autonomía', texto: 'Sin estimación', pie: 'Sin conexión: esperando lecturas recientes del tanque' };
  if (!a) return { label: 'Autonomía', texto: 'Sin estimación', pie: 'Esperando lecturas válidas del tanque' };
  const trend = a.basis === 'tendencia_volumen' || a.basis === 'tendencia_nivel';
  const projection = a.basis === 'proyeccion_24h' || a.basis === 'proyeccion_actual';
  if (a.hoursTo0 === null && a.hoursToReserve == null) {
    return { label: 'Autonomía', texto: 'Sin estimación', pie: 'Se necesita un descenso sostenido y suficientes lecturas del tanque' };
  }
  const reserve = a.hoursToReserve;
  const reserveName = a.reserveBasis === '50_percent' ? 'referencia del 50 %' : 'mínimo';
  const texto = reserve != null
    ? reserve === 0 ? a.reserveBasis === '50_percent' ? 'Referencia del 50 % alcanzada' : 'Mínimo alcanzado'
      : `${autonomyDuration(reserve)} hasta ${reserveName}`
    : a.hoursTo0 !== null ? `${autonomyDuration(a.hoursTo0)} hasta vacío` : 'Sin estimación';
  const source = a.limitation
    ? 'Nivel medido · todavía sin tendencia de vaciado fiable'
    : trend
    ? 'Según el descenso medido de este tanque'
    : a.basis === 'vaciado_real'
      ? `Balance neto de caudales (${a.flowLps.toFixed(1)} l/s)`
      : a.basis === 'proyeccion_24h'
        ? `Supuesto con consumo medio de 24 h (${a.flowLps.toFixed(1)} l/s)`
        : `Supuesto con caudal actual (${a.flowLps.toFixed(1)} l/s)`;
  const empty = reserve != null && a.hoursTo0 !== null ? ` · ${autonomyDuration(a.hoursTo0)} hasta vacío` : '';
  const reserveNote = a.reserveBasis === '50_percent' ? ' · Referencia: 50 % (sin mínimo configurado)' : '';
  return { label: projection && !a.limitation ? 'Autonomía si cierras' : 'Autonomía estimada', texto, pie: `${source}${empty}${reserveNote}` };
}
