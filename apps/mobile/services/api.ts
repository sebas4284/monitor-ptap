import Constants from 'expo-constants';
import type { AuthUser } from '@ptap/shared';

export type { AuthUser };

/**
 * Cliente REST REAL del backend Monitor PTAP. CERO mocks: los datos salen del pipeline
 * de dominio (PLC → puente → cache RAM → REST). Los placeholders de features aún sin
 * mapear (válvulas/reportes) viven en services/mock-data.ts, claramente separados;
 * los tanques ya son reales (services/tanks.ts, derivados del snapshot).
 *
 * La base URL se configura en app.json → expo.extra.apiBaseUrl (o localhost en dev).
 * En un dispositivo físico debe ser la IP LAN del backend, no localhost.
 */
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ?? 'http://localhost:4000';

// ── Sesión: el JWT viaja en cada petición (el backend completo exige Authorization) ──

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Lo llama AuthContext al restaurar/iniciar/cerrar sesión. null = sin sesión. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/**
 * Callback para un 401 del backend (token vencido/inválido): AuthContext registra su
 * logout aquí, de modo que una sesión muerta se limpie sola en vez de dejar la app
 * mostrando errores con un token que ya no sirve.
 */
export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

// ── Contrato del DTO (espejo de PlantSnapshotDto del backend) ────────────────────

export type LivenessState = 'live' | 'idle' | 'stale' | 'unknown';
export type Confidence = 'confirmed' | 'inferred' | 'estimated';
export type OpcQuality = 'Good' | 'Bad' | 'Uncertain';
export type UnusableReason = 'BAD_QUALITY' | 'INVALID_NUMBER' | 'BRIDGE_STALE';

export interface SignalDto {
  value: number | boolean | null;
  unit: string | null;
  quality: OpcQuality;
  usable: boolean;
  reason?: UnusableReason;
  /** true si el valor cae fuera de [min, max] del mapping. Es un aviso (futura alerta):
   * el valor SIGUE mostrándose, nunca se oculta solo por esto. */
  outOfRange?: boolean;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: Confidence;
  label: string | null;
  ts: string | null;
  /** Rango operativo entregado por el operador — se muestra junto al valor (Mín/Máx). */
  opMin?: number;
  opMax?: number;
}

export interface LivenessDto {
  state: LivenessState;
  lastChangeAt: string | null;
  windowSec: number;
}

export interface PlantSnapshotDto {
  plantId: string;
  displayName: string;
  sequence: number;
  protocolVersion?: string;
  dtoVersion?: string;
  bridgeStatus: string;
  liveness: LivenessDto;
  signals: Record<string, SignalDto>;
  pending?: boolean;
}

export interface PlantListItem {
  plantId: string;
  displayName: string;
  liveness: LivenessDto;
  bridgeStatus: string;
}

export interface LivenessChange {
  plantId: string;
  state: LivenessState;
  lastChangeAt: string | null;
  windowSec: number;
}

/** Mensaje de error del backend (Nest devuelve { message }), o un fallback legible. */
async function errorMessage(res: Response, path: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    if (msg) return msg;
  } catch {
    /* respuesta sin JSON */
  }
  return `${path} → ${res.status}`;
}

async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    onUnauthorized?.(); // sesión vencida/inválida → que AuthContext la limpie
    throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
  }
  if (!res.ok) throw new Error(await errorMessage(res, path));
  return (await res.json()) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PATCH', path, body);
}

/** Lista de plantas con su liveness (GET /api/plants). */
export async function fetchPlants(): Promise<PlantListItem[]> {
  const body = await getJson<{ plants: PlantListItem[] }>('/api/plants');
  return body.plants;
}

/** Snapshot de dominio de una planta desde cache RAM (GET /api/plants/:id/snapshot). */
export async function fetchSnapshot(plantId: string): Promise<PlantSnapshotDto> {
  return getJson<PlantSnapshotDto>(`/api/plants/${plantId}/snapshot`);
}
