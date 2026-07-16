export type Role = 'civil' | 'operador' | 'jefe' | 'admin';

export type Permission =
  | 'view_dashboard'
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
  civil: [],
  operador: [
    'view_dashboard',
    'control_valves',
    'acknowledge_alarms',
    'adjust_setpoints',
    'view_event_logs',
  ],
  jefe: [
    'view_dashboard',
    'acknowledge_alarms',
    'adjust_setpoints',
    'view_event_logs',
  ],
  admin: [
    'view_dashboard',
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
  'view_dashboard',
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
  view_dashboard: 'Ver el panel principal y los datos en tiempo real',
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
