/**
 * PLACEHOLDERS de features aún NO mapeadas (tanques, válvulas, reportes). NO son datos
 * reales del PLC: sin el export L5X no existe semántica confirmada para estas señales.
 * Se mantienen aparte de services/api.ts (que es el cliente REAL) y claramente marcados
 * para que nadie los confunda con telemetría real. Se eliminan cuando esas señales entren
 * al mapping (ver docs/DEPRECATION.md y el flujo de caudal ya real en services/api.ts).
 */

export interface Valve {
  id: string;
  name: string;
  description: string;
  isOpen: boolean;
}

export interface Tank {
  id: string;
  name: string;
  percentage: number;
  levelM: number;
  maxLevelM: number;
  volumeM3: number;
  maxVolumeM3: number;
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

const BASE_TANKS: Tank[] = [
  { id: 'tank-1', name: 'Tanque 1', percentage: 70, levelM: 3.5, maxLevelM: 5, volumeM3: 350, maxVolumeM3: 500 },
  { id: 'tank-2', name: 'Tanque 2', percentage: 23, levelM: 1.15, maxLevelM: 5, volumeM3: 115, maxVolumeM3: 500 },
  { id: 'tank-3', name: 'Tanque 3', percentage: 85, levelM: 4.25, maxLevelM: 5, volumeM3: 425, maxVolumeM3: 500 },
  { id: 'tank-4', name: 'Tanque 4', percentage: 50, levelM: 2.5, maxLevelM: 5, volumeM3: 250, maxVolumeM3: 500 },
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

export async function fetchTanks(_plant: string): Promise<Tank[]> {
  await delay(150);
  return BASE_TANKS;
}

export async function fetchReports(_plant: string): Promise<Report[]> {
  await delay(150);
  return MOCK_REPORTS;
}
