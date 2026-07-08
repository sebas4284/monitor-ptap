import type { Role, AuthUser, Sensor as SharedSensor, Tank as SharedTank, Valve as SharedValve, OpcSnapshot } from '@ptap/shared';

export type { AuthUser };

export interface Sensor extends SharedSensor {}
export interface Valve extends SharedValve {}
export interface Tank extends SharedTank {}

export interface Report {
  id: string;
  title: string;
  date: string;
  status: 'pending' | 'generated';
  type: string;
  icon: string;
}

const API_BASE = '/api';

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchSensors(plant: string): Promise<Sensor[]> {
  const snapshot = await api<OpcSnapshot>(`/snapshots/${encodeURIComponent(plant)}`);
  return snapshot.sensors ?? [];
}

export async function fetchValves(plant: string): Promise<Valve[]> {
  const snapshot = await api<OpcSnapshot>(`/snapshots/${encodeURIComponent(plant)}`);
  return snapshot.valves ?? [];
}

export async function fetchTanks(plant: string): Promise<Tank[]> {
  const snapshot = await api<OpcSnapshot>(`/snapshots/${encodeURIComponent(plant)}`);
  return snapshot.tanks ?? [];
}

export async function fetchReports(_plant: string): Promise<Report[]> {
  return [];
}

export async function fetchPlants(): Promise<Array<{ id: string; name: string }>> {
  return api<Array<{ id: string; name: string }>>('/plants');
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
