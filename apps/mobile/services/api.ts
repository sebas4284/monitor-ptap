import Constants from 'expo-constants';
import type { AuthUser, PlantSnapshotDto, PlantBasicStatusDto, PlantListItem } from '@ptap/shared';

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

// ── Contrato del DTO (DEF-08: fuente ÚNICA en @ptap/shared, ya sin espejo a mano) ──
// Antes estos tipos se duplicaban aquí con `bridgeStatus: string`, perdiendo la verificación
// de los 6 estados del puente. Ahora el móvil importa el MISMO tipo que emite el backend:
// un campo nuevo o un estado nuevo se declara una vez en shared y el typecheck fuerza la sincronía.
export type {
  BridgeStatus,
  OpcQuality,
  LivenessState,
  UnusableReason,
  Confidence,
  SignalDto,
  LivenessDto,
  PlantSnapshotDto,
  LivenessChange,
  PlantBasicStatusDto,
  PlantListItem,
} from '@ptap/shared';

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

/**
 * Snapshot de dominio DETALLADO (GET /api/plants/:id/snapshot). Exige el permiso
 * `view_dashboard`: con un token de rol Civil el backend responde 403 — usa fetchBasicStatus.
 */
export async function fetchSnapshot(plantId: string): Promise<PlantSnapshotDto> {
  return getJson<PlantSnapshotDto>(`/api/plants/${plantId}/snapshot`);
}

/** Estado básico de una planta (GET /api/plants/:id/status). Permiso: `view_basic_status`. */
export async function fetchBasicStatus(plantId: string): Promise<PlantBasicStatusDto> {
  return getJson<PlantBasicStatusDto>(`/api/plants/${plantId}/status`);
}

/**
 * Un evento de conexión del puente (GET /api/diagnostics/connection-events, solo admin).
 * `detail` es lo que grabó ConnectionEventsSubscriber: `{ status, reason }`.
 */
export interface ConnectionEvent {
  at: string;
  eventType: string;
  detail: { status?: string; reason?: string } | null;
}

/** Historial de transiciones del puente para el diagnóstico del admin. Requiere `system_config`. */
export async function fetchConnectionEvents(): Promise<ConnectionEvent[]> {
  const body = await getJson<{ events: ConnectionEvent[] }>('/api/diagnostics/connection-events');
  return body.events;
}

// ── Prueba de ruta en vivo (GET /api/diagnostics/route-check, solo admin) ────────

/** Una sonda del backend: internet del servidor, ping ICMP al host, o TCP al puerto OPC. */
export interface RouteProbe {
  name: 'internet' | 'ping' | 'plc';
  target: string; // host[:puerto]
  outcome: 'ok' | 'timeout' | 'refused' | 'error';
  ms: number;
  detail: string | null;
}

/**
 * Resultado de la prueba de ruta servidor→PLC. El veredicto dice DÓNDE está fallando con
 * evidencia (sondas reales), en vez de suponer un culpable: `servidor` = el internet del
 * propio servidor; `ruta-o-planta` = paquetes sin respuesta hacia la planta; `plc-servicio` =
 * host vivo pero el servicio OPC caído; `ninguno` = la red está bien.
 */
export interface RouteCheckReport {
  at: string;
  target: { endpoint: string; host: string; port: number };
  /** IP pública del servidor — con ella un técnico identifica al proveedor (whois). */
  serverPublicIp: string | null;
  probes: RouteProbe[];
  verdict: { code: string; where: 'servidor' | 'ruta-o-planta' | 'plc-servicio' | 'ninguno'; message: string };
  bridge: { status: string; reconnectCount: number; lastNotificationAt: string | null };
}

/** Ejecuta la prueba de ruta EN VIVO (tarda ≤ ~5 s por los timeouts de sonda). Requiere `system_config`. */
export async function runRouteCheck(): Promise<RouteCheckReport> {
  return getJson<RouteCheckReport>('/api/diagnostics/route-check');
}

// ── Registro continuo 24 h (GET /api/diagnostics/route-history, solo admin) ─────

export interface RouteHistorySummary {
  windowHours: number;
  samples: number;
  plcOk: number;
  /** % de muestras en las que el puerto del PLC aceptó conexión. */
  uptimePct: number;
  oldestAt: string | null;
  newestAt: string | null;
  /** Inicio del corte VIGENTE (null si la última muestra fue OK). */
  downSince: string | null;
}

/** Una muestra del sampler (detalle compacto persistido en audit_log). */
export interface RouteHistorySample {
  at: string;
  eventType: string;
  detail: {
    /** 'auto' = prueba oculta de cada hora en punto; 'manual' = botón del admin. */
    source?: 'auto' | 'manual';
    code?: string;
    where?: string;
    bridge?: string;
    target?: string;
    probes?: Record<string, { outcome: string; ms: number }>;
  } | null;
}

export interface RouteHistoryResponse {
  summary: RouteHistorySummary;
  samples: RouteHistorySample[];
}

/** Registro interno de la ruta (20 h): prueba automática oculta cada hora en punto + las
 *  manuales del botón. Requiere `system_config`. */
export async function fetchRouteHistory(): Promise<RouteHistoryResponse> {
  return getJson<RouteHistoryResponse>('/api/diagnostics/route-history');
}
