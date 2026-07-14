import type { Role, AuthUser } from '@ptap/shared';

/**
 * Stub de autenticación. El backend de auth (JWT/RBAC) está FUERA DE ALCANCE de esta
 * fase (ver la lista NO-implementar). Se mantiene aparte de services/api.ts para que el
 * cliente REAL de telemetría no contenga stubs. Al cablear auth real, este archivo se
 * reemplaza por llamadas a /api/auth.
 */

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

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function apiLogin(email: string, _password: string): Promise<{ token: string; user: AuthUser }> {
  await delay(400);
  if (!email) throw new Error('Credenciales inválidas');
  const role = mockRole(email);
  const user: AuthUser = {
    id: `user-${Date.now()}`,
    name: ROLE_NAMES[role],
    email,
    role,
    plant: 'montebello', // slug canónico
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
  await delay(400);
  if (!data.email || !data.password) throw new Error('Datos incompletos');
}
