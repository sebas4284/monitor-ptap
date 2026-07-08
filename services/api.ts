import type { Role, AuthUser } from '../constants/roles';

export type { AuthUser };

export interface Sensor {
  id: string;
  name: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  status: 'ok' | 'warning' | 'error';
  icon: string;
}

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

const BASE_SENSORS: Sensor[] = [
  { id: 'pressure', name: 'Presión',   value: 42.5,  unit: 'psi',   min: 30,  max: 60,  status: 'ok',      icon: 'speedometer-outline' },
  { id: 'flow',     name: 'Caudal',    value: 187.3, unit: 'm³/h',  min: 100, max: 250, status: 'ok',      icon: 'water-outline' },
  { id: 'ph',       name: 'pH',        value: 7.2,   unit: 'pH',    min: 6.5, max: 8.5, status: 'ok',      icon: 'flask-outline' },
  { id: 'turbidity',name: 'Turbidez',  value: 3.8,   unit: 'NTU',   min: 0,   max: 5,   status: 'warning', icon: 'eye-outline' },
];

const BASE_VALVES: Valve[] = [
  { id: 'ev-01', name: 'EV-01', description: 'Entrada principal captación', isOpen: true  },
  { id: 'ev-02', name: 'EV-02', description: 'Bypass coagulación',          isOpen: false },
  { id: 'ev-03', name: 'EV-03', description: 'Filtración etapa 1',          isOpen: true  },
  { id: 'ev-04', name: 'EV-04', description: 'Cloración dosificación',      isOpen: false },
  { id: 'ev-05', name: 'EV-05', description: 'Salida distribución',         isOpen: true  },
];

const BASE_TANKS: Tank[] = [
  { id: 'tank-1', name: 'Tanque 1', percentage: 70, levelM: 3.5,  maxLevelM: 5, volumeM3: 350, maxVolumeM3: 500 },
  { id: 'tank-2', name: 'Tanque 2', percentage: 23, levelM: 1.15, maxLevelM: 5, volumeM3: 115, maxVolumeM3: 500 },
  { id: 'tank-3', name: 'Tanque 3', percentage: 85, levelM: 4.25, maxLevelM: 5, volumeM3: 425, maxVolumeM3: 500 },
  { id: 'tank-4', name: 'Tanque 4', percentage: 50, levelM: 2.5,  maxLevelM: 5, volumeM3: 250, maxVolumeM3: 500 },
];

const MOCK_REPORTS: Report[] = [
  { id: 'r1', title: 'Reporte Diario Calidad',    date: '2026-06-26 08:00', status: 'generated', type: 'quality',      icon: 'checkmark-circle-outline' },
  { id: 'r2', title: 'Control de Cloración',      date: '2026-06-26 06:00', status: 'generated', type: 'chlorination', icon: 'checkmark-circle-outline' },
  { id: 'r3', title: 'Reporte de Turbidez',       date: '2026-06-25 22:00', status: 'pending',   type: 'turbidity',    icon: 'warning-outline' },
  { id: 'r4', title: 'Consumo Energético',        date: '2026-06-25 20:00', status: 'generated', type: 'energy',       icon: 'checkmark-circle-outline' },
  { id: 'r5', title: 'Mantenimiento Preventivo',  date: '2026-06-25 18:00', status: 'pending',   type: 'maintenance',  icon: 'warning-outline' },
];

function jitter(value: number, range: number): number {
  return Math.round((value + (Math.random() - 0.5) * range) * 10) / 10;
}

export async function fetchSensors(_plant: string): Promise<Sensor[]> {
  await delay(300);
  return BASE_SENSORS.map(s => ({
    ...s,
    value: jitter(s.value, (s.max - s.min) * 0.04),
  }));
}

export async function fetchValves(_plant: string): Promise<Valve[]> {
  await delay(200);
  return BASE_VALVES;
}

export async function fetchTanks(_plant: string): Promise<Tank[]> {
  await delay(250);
  return BASE_TANKS.map(t => {
    const pct = Math.min(100, Math.max(0, jitter(t.percentage, 1.5)));
    return {
      ...t,
      percentage: pct,
      levelM: Math.round((pct / 100) * t.maxLevelM * 100) / 100,
      volumeM3: Math.round((pct / 100) * t.maxVolumeM3),
    };
  });
}

export async function fetchReports(_plant: string): Promise<Report[]> {
  await delay(200);
  return MOCK_REPORTS;
}

function mockRole(email: string): Role {
  const lower = email.toLowerCase();
  if (lower.startsWith('admin@')) return 'admin';
  if (lower.startsWith('jefe@')) return 'jefe';
  if (lower.startsWith('civil@')) return 'civil';
  return 'operador';
}

const ROLE_NAMES: Record<Role, string> = {
  civil: 'Visitante Civil',
  operador: 'Operador de Planta',
  jefe: 'Jefe de Planta',
  admin: 'Administrador',
};

export async function apiLogin(
  email: string,
  _password: string,
): Promise<{ token: string; user: AuthUser }> {
  await delay(600);
  if (!email) throw new Error('Credenciales inválidas');
  const role = mockRole(email);
  const user: AuthUser = {
    id: `user-${Date.now()}`,
    name: ROLE_NAMES[role],
    email,
    role,
    plant: 'PTAP Norte',
  };
  return { token: `ptap-jwt-${Date.now()}`, user };
}

export async function apiRegister(data: {
  name: string;
  email: string;
  phone: string;
  plant: string;
  role: Role;
  password: string;
}): Promise<void> {
  await delay(600);
  if (!data.email || !data.password) throw new Error('Datos incompletos');
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
