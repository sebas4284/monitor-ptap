/**
 * PLACEHOLDERS de features aún NO mapeadas (válvulas, reportes). NO son datos
 * reales del PLC: sin el export L5X no existe semántica confirmada para estas señales.
 * Se mantienen aparte de services/api.ts (que es el cliente REAL) y claramente marcados
 * para que nadie los confunda con telemetría real. Se eliminan cuando esas señales entren
 * al mapping (ver docs/DEPRECATION.md y el flujo de caudal ya real en services/api.ts).
 * Los TANQUES ya salieron de aquí: son reales, derivados del snapshot (services/tanks.ts).
 */

export interface Valve {
  id: string;
  name: string;
  description: string;
  isOpen: boolean;
}

export interface Report {
  id: string;
  title: string;
  date: string;
  status: 'pending' | 'generated';
  type: string;
  icon: string;
}

const BASE_VALVES: Valve[] = [
  { id: 'ev-01', name: 'EV-01', description: 'Entrada principal captación', isOpen: true },
  { id: 'ev-02', name: 'EV-02', description: 'Bypass coagulación', isOpen: false },
  { id: 'ev-03', name: 'EV-03', description: 'Filtración etapa 1', isOpen: true },
  { id: 'ev-04', name: 'EV-04', description: 'Cloración dosificación', isOpen: false },
  { id: 'ev-05', name: 'EV-05', description: 'Salida distribución', isOpen: true },
];

const MOCK_REPORTS: Report[] = [
  { id: 'r1', title: 'Reporte Diario Calidad', date: '2026-06-26 08:00', status: 'generated', type: 'quality', icon: 'checkmark-circle-outline' },
  { id: 'r2', title: 'Control de Cloración', date: '2026-06-26 06:00', status: 'generated', type: 'chlorination', icon: 'checkmark-circle-outline' },
  { id: 'r3', title: 'Reporte de Turbidez', date: '2026-06-25 22:00', status: 'pending', type: 'turbidity', icon: 'warning-outline' },
  { id: 'r4', title: 'Consumo Energético', date: '2026-06-25 20:00', status: 'generated', type: 'energy', icon: 'checkmark-circle-outline' },
  { id: 'r5', title: 'Mantenimiento Preventivo', date: '2026-06-25 18:00', status: 'pending', type: 'maintenance', icon: 'warning-outline' },
];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchValves(_plant: string): Promise<Valve[]> {
  await delay(150);
  return BASE_VALVES;
}

export async function fetchReports(_plant: string): Promise<Report[]> {
  await delay(150);
  return MOCK_REPORTS;
}
