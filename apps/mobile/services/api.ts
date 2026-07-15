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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
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
