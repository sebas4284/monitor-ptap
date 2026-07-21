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
