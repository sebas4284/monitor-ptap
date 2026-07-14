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
