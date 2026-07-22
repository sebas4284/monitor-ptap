export type Role = 'civil' | 'operador' | 'jefe' | 'admin';

export type Permission =
  /** Estado básico de la planta: "¿opera?" y "¿hay agua?". Lo tienen TODOS los roles —
   *  es lo único que la matriz oficial concede al Civil. */
  | 'view_basic_status'
  | 'view_dashboard'
  /** Consultar plantas DISTINTAS a la del propio usuario. Cada cuenta está vinculada a una
   *  planta (`user.plant`); sin este permiso, pedir otra devuelve 403. Solo el Admin, que por
   *  la matriz oficial tiene control total, supervisa las 12. */
  | 'view_all_plants'
  | 'control_valves'
  | 'acknowledge_alarms'
  | 'adjust_setpoints'
  | 'view_event_logs'
  | 'manage_users'
  | 'assign_roles'
  | 'configure_alarms'
  | 'export_data'
  | 'system_config';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  plant: string;
}

/**
 * Usuario tal como lo expone la API de administración (GET /api/users). NUNCA lleva
 * password_hash ni pepper_version. Fuente única compartida backend↔móvil.
 */
export interface UserSummary {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  plant: string;
  isActive: boolean;
  /** Correo verificado (anti-bot). Un admin NO puede activar una cuenta con esto en false. */
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'mock';

/**
 * De dónde viene un corte de datos, en el lenguaje del producto (no de OPC UA):
 *   ok            → todo fluye.
 *   ip            → el DISPOSITIVO no alcanza al servidor (su propia red/internet). Lo detecta
 *                   el cliente cuando la petición falla, no el backend.
 *   route         → el SERVIDOR no alcanza al PLC (la ruta de red intermedia: VPN, firewall,
 *                   IP cambiada). Es un problema de infraestructura que solo el admin debe ver
 *                   y escalar; a un operador no le aporta y lo alarmaría en vano.
 *   master_no_data→ el servidor SÍ tuvo sesión con el PLC pero el maestro dejó de enviar datos.
 */
export type ConnectionFault = 'ok' | 'ip' | 'route' | 'master_no_data';

/**
 * Clasifica un corte a partir del estado del puente. NO cubre 'ip': esa se decide en el
 * cliente (si la API responde, no es un problema de IP del usuario), así que esta función
 * asume que el backend fue alcanzable.
 *
 * - `Connected`  → 'ok': hay sesión y datos.
 * - `Stale`      → 'master_no_data': hubo sesión y el dato paró → el maestro dejó de enviar.
 * - resto (`Connecting`/`Disconnected`/`Recovering`/`Faulted`) → 'route': no se pudo
 *   establecer o sostener la sesión con el PLC. `Faulted` se incluye a propósito: es un fallo
 *   técnico (p. ej. namespace que ya no resuelve) que el admin debe escalar, no algo que deba
 *   alarmar a un operador.
 */
export function classifyBridge(bridgeStatus: string): Exclude<ConnectionFault, 'ip'> {
  if (bridgeStatus === 'Connected') return 'ok';
  if (bridgeStatus === 'Stale') return 'master_no_data';
  return 'route';
}

/**
 * Códigos de los cortes de conexión que ve el usuario, para reportes precisos. La nomenclatura
 * completa del proyecto vive en docs/CATALOGO_ERRORES.md; estos son los que la app muestra en el
 * banner y en el informe exportable. `NET-*` = lado del dispositivo; `PLC-*` = lado del servidor.
 */
export const CONNECTION_CODES = {
  /** El dispositivo no está conectado a ninguna red (WiFi/datos apagados). */
  NO_NETWORK: 'NET-01',
  /** Hay red pero sin salida a internet (problema del proveedor). */
  NO_INTERNET: 'NET-02',
  /** Hay internet pero el servidor del sistema no responde. */
  SERVER_DOWN: 'NET-03',
  /** El servidor no alcanza el PLC (ruta de red intermedia). Solo admin. */
  PLC_ROUTE: 'PLC-01',
  /** Hubo sesión con el PLC pero el maestro dejó de enviar datos. */
  PLC_NO_DATA: 'PLC-02',
} as const;

export type ConnectionCode = (typeof CONNECTION_CODES)[keyof typeof CONNECTION_CODES];

// ── Contrato del snapshot de planta (DEF-08: fuente ÚNICA backend↔móvil) ─────────────
// Antes el móvil duplicaba estos tipos a mano en services/api.ts (con `bridgeStatus: string`,
// perdiendo la verificación de los 6 estados) sin barrera técnica que forzara la sincronía.
// Ahora ambos lados importan de aquí: un campo nuevo o un estado nuevo se declara UNA vez.

/** Estado del puente OPC UA servidor↔PLC. Espejo exacto de la máquina de estados del backend. */
export type BridgeStatus =
  | 'Connecting'
  | 'Connected'
  | 'Recovering'
  | 'Stale'
  | 'Disconnected'
  | 'Faulted';

export type OpcQuality = 'Good' | 'Bad' | 'Uncertain';

/**
 * Frescura de datos de la planta. La diferencia entre los dos últimos es la salud de la SESIÓN,
 * no el reloj: `stable` = sesión sana con valores quietos (operación NORMAL, datos válidos);
 * `frozen` = perdimos la fuente y el dato ya no es fiable.
 */
export type LivenessState = 'live' | 'stable' | 'frozen';

/** Razón por la que una señal no es usable (QualityService del backend). */
export type UnusableReason = 'BAD_QUALITY' | 'INVALID_NUMBER' | 'BRIDGE_STALE';

export type Confidence = 'confirmed' | 'inferred' | 'estimated';

export interface SignalDto {
  value: number | boolean | null;
  unit: string | null;
  quality: OpcQuality;
  usable: boolean;
  reason?: UnusableReason;
  /** true si el valor cae fuera de [min, max] del mapping. Informativo/alerta — el valor
   * SIGUE mostrándose (nunca se oculta por esto solo). */
  outOfRange?: boolean;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: Confidence;
  label: string | null;
  /** SourceTimestamp del PLC (regla 7: nunca Date.now() para datos). */
  ts: string | null;
  /** Rango operativo/normativo entregado por el operador; el front lo muestra junto al valor. */
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
  /** Opcionales EN EL CABLE: la respuesta `pending` del arranque de telemetría no los incluye.
   *  El SnapshotBuilder del backend los emite siempre. */
  protocolVersion?: string;
  dtoVersion?: string;
  bridgeStatus: BridgeStatus;
  liveness: LivenessDto;
  signals: Record<string, SignalDto>;
  /** true si aún no hay snapshot en cache para esa planta (respuesta de espera, sin señales). */
  pending?: boolean;
}

/** Cambio de liveness para el evento Socket.IO `opc:liveness`. */
export interface LivenessChange {
  plantId: string;
  state: LivenessState;
  lastChangeAt: string | null;
  windowSec: number;
}

/**
 * Vista MÍNIMA de la planta para el rol Civil. Whitelist deliberada, no un snapshot recortado:
 * NO viaja `signals`, así que el dispositivo del Civil nunca recibe caudales ni presiones.
 */
export interface PlantBasicStatusDto {
  plantId: string;
  displayName: string;
  bridgeStatus: BridgeStatus;
  liveness: LivenessDto;
  /** null = la planta no tiene señales de tanque mapeadas (no se puede afirmar ni negar). */
  waterAvailable: boolean | null;
}

/** Elemento de GET /api/plants. */
export interface PlantListItem {
  plantId: string;
  displayName: string;
  liveness: LivenessDto;
  bridgeStatus: BridgeStatus;
}

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

export interface OpcSnapshot {
  plantId: string;
  timestamp: string;
  connectionStatus: ConnectionStatus;
  sensors: Sensor[];
  tanks: Tank[];
  valves?: Valve[];
}

export interface PlantDefinition {
  id: string;
  name: string;
}

export const ROLES: Role[] = ['civil', 'operador', 'jefe', 'admin'];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // El Civil solo observa el estado básico: es exactamente lo que la matriz oficial le
  // concede ("ver si el sistema funciona" y "ver si hay agua"), y nada más.
  civil: ['view_basic_status'],
  operador: [
    'view_basic_status',
    'view_dashboard',
    'control_valves',
    'acknowledge_alarms',
    'adjust_setpoints',
    'view_event_logs',
  ],
  jefe: [
    'view_basic_status',
    'view_dashboard',
    'acknowledge_alarms',
    'adjust_setpoints',
    'view_event_logs',
  ],
  admin: [
    'view_basic_status',
    'view_dashboard',
    'view_all_plants',
    'control_valves',
    'acknowledge_alarms',
    'adjust_setpoints',
    'view_event_logs',
    'manage_users',
    'assign_roles',
    'configure_alarms',
    'export_data',
    'system_config',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Todos los permisos, en el orden de la matriz oficial (para renderizarla en la UI). */
export const PERMISSIONS: Permission[] = [
  'view_basic_status',
  'view_dashboard',
  'view_all_plants',
  'acknowledge_alarms',
  'adjust_setpoints',
  'view_event_logs',
  'control_valves',
  'manage_users',
  'assign_roles',
  'configure_alarms',
  'export_data',
  'system_config',
];

/** Texto de cada permiso, tal como aparece en la matriz oficial del cronograma. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  view_basic_status: 'Ver si el sistema funciona y si hay agua disponible',
  view_dashboard: 'Ver el panel principal y los datos en tiempo real',
  view_all_plants: 'Consultar todas las plantas, no solo la propia',
  acknowledge_alarms: 'Reconocer y silenciar alarmas activas',
  adjust_setpoints: 'Ajustar parámetros o setpoints de operación',
  view_event_logs: 'Ver los registros de eventos del sistema',
  control_valves: 'Abrir y cerrar válvulas',
  manage_users: 'Crear, editar y eliminar usuarios',
  assign_roles: 'Asignar roles a los usuarios',
  configure_alarms: 'Configurar los límites de las alarmas',
  export_data: 'Exportar el historial completo de datos',
  system_config: 'Acceder a la configuración general del sistema',
};

export const ROLE_LABELS: Record<Role, string> = {
  civil: 'Civil',
  operador: 'Operador',
  jefe: 'Jefe PTAP',
  admin: 'Administrador',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  civil: 'Vista básica',
  operador: 'Datos y control',
  jefe: 'Datos, sin control',
  admin: 'Control total',
};

export const ROLE_COLORS: Record<Role, string> = {
  civil: '#78909C',
  operador: '#1565C0',
  jefe: '#6A1B9A',
  admin: '#B71C1C',
};

// El RBAC del backend (Fase 4) gatea por permiso granular usando ROLE_PERMISSIONS/
// hasPermission (arriba) — la MISMA fuente que consume el móvil para features de UI.
// Se retiró el antiguo sistema paralelo de tiers (RoleTier/ROLE_TIER/tierAtLeast) porque
// no podía expresar la matriz oficial (p. ej. `jefe` = todo lo del operador salvo válvulas).
