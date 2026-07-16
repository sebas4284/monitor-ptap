/**
 * Unit tests de los guards RBAC (Fase 4) contra un ExecutionContext fabricado a mano
 * — sin Nest testing module, mismo estilo liviano que el resto de la suite.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';
import type { AuthenticatedRequest } from '../src/modules/auth/authenticated-request';
import type { UserRecord, UsersRepository } from '../src/modules/users/users.repository';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-jwt-auth-guard';

function fakeContext(request: Partial<AuthenticatedRequest>, metadata: Record<string, unknown> = {}): ExecutionContext {
  const handler = () => undefined;
  const klass = class {};
  Object.entries(metadata).forEach(([key, value]) => Reflect.defineMetadata(key, value, handler));
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => handler,
    getClass: () => klass,
  } as unknown as ExecutionContext;
}

/**
 * Repo doble. Emula lo que hace el real: `findById` solo devuelve usuarios VIGENTES, así que
 * `activo: false` (cuenta desactivada) se representa devolviendo null, igual que el
 * `AND is_active = 1` del SQL.
 */
function fakeUsers(user: Partial<UserRecord> | null): UsersRepository {
  const record = user
    ? ({
        id: 'u1', email: 'a@b.com', name: 'A', role: 'admin', plant: 'montebello',
        passwordHash: 'x', pepperVersion: 1, isActive: true, ...user,
      } as UserRecord)
    : null;
  return { findById: async () => record } as unknown as UsersRepository;
}

test('JwtAuthGuard: sin Authorization header → UnauthorizedException (401)', async () => {
  const guard = new JwtAuthGuard(new Reflector(), new JwtService(), fakeUsers({}));
  const ctx = fakeContext({ headers: {} } as AuthenticatedRequest);
  await assert.rejects(() => guard.canActivate(ctx), UnauthorizedException);
});

test('JwtAuthGuard: token inválido → UnauthorizedException (401)', async () => {
  const guard = new JwtAuthGuard(new Reflector(), new JwtService(), fakeUsers({}));
  const ctx = fakeContext({ headers: { authorization: 'Bearer no-es-un-jwt' } } as AuthenticatedRequest);
  await assert.rejects(() => guard.canActivate(ctx), UnauthorizedException);
});

test('JwtAuthGuard: @Public() deja pasar sin token (y sin tocar la base)', async () => {
  const users = { findById: async () => { throw new Error('una ruta pública NO debe consultar la base'); } };
  const guard = new JwtAuthGuard(new Reflector(), new JwtService(), users as unknown as UsersRepository);
  const ctx = fakeContext({ headers: {} } as AuthenticatedRequest, { isPublic: true });
  assert.equal(await guard.canActivate(ctx), true);
});

test('JwtAuthGuard: token válido → setea request.user y permite', async () => {
  const jwt = new JwtService();
  const token = jwt.sign({ sub: 'u1', email: 'a@b.com', name: 'A', role: 'admin', plant: 'montebello' });
  const guard = new JwtAuthGuard(new Reflector(), jwt, fakeUsers({}));
  const request = { headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest;
  const ctx = fakeContext(request);
  assert.equal(await guard.canActivate(ctx), true);
  assert.equal(request.user?.role, 'admin');
  assert.equal(request.user?.id, 'u1');
});

// ── Revocación: el JWT es una credencial, no una autorización ──

test('JwtAuthGuard: token con firma válida pero cuenta DESACTIVADA → 401 (no espera a que caduque)', async () => {
  const jwt = new JwtService();
  const token = jwt.sign({ sub: 'u1', email: 'a@b.com', name: 'A', role: 'admin', plant: 'montebello' });
  // findById filtra is_active = 1 → una cuenta desactivada no existe para el guard.
  const guard = new JwtAuthGuard(new Reflector(), jwt, fakeUsers(null));
  const request = { headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest;
  await assert.rejects(
    () => guard.canActivate(fakeContext(request)),
    UnauthorizedException,
    'desactivar una cuenta debe expulsar a esa sesión en la siguiente petición',
  );
});

test('JwtAuthGuard: el rol lo manda la BASE, no el token (admin degradado a civil aplica ya)', async () => {
  const jwt = new JwtService();
  // Token emitido cuando la persona era admin…
  const token = jwt.sign({ sub: 'u1', email: 'a@b.com', name: 'A', role: 'admin', plant: 'montebello' });
  // …pero un admin ya la degradó a civil en la base.
  const guard = new JwtAuthGuard(new Reflector(), jwt, fakeUsers({ role: 'civil' }));
  const request = { headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest;
  assert.equal(await guard.canActivate(fakeContext(request)), true);
  assert.equal(request.user?.role, 'civil', 'un rol degradado NO puede sobrevivir en el token');
});

test('PermissionGuard: sin @RequirePermission() declarado → no-op, permite', () => {
  const guard = new PermissionGuard(new Reflector());
  const ctx = fakeContext({} as AuthenticatedRequest);
  assert.equal(guard.canActivate(ctx), true);
});

test('PermissionGuard: permiso insuficiente (civil pide system_config) → ForbiddenException (403)', () => {
  const guard = new PermissionGuard(new Reflector());
  const request = { user: { id: 'u1', name: 'A', email: 'a@b.com', role: 'civil', plant: 'montebello' } } as AuthenticatedRequest;
  const ctx = fakeContext(request, { requiredPermission: 'system_config' });
  assert.throws(() => guard.canActivate(ctx), ForbiddenException);
});

// El caso clave: jefe tiene acknowledge_alarms pero NO control_valves (matriz oficial).
test('PermissionGuard: jefe permite acknowledge_alarms pero rechaza control_valves', () => {
  const guard = new PermissionGuard(new Reflector());
  const request = { user: { id: 'u1', name: 'J', email: 'j@b.com', role: 'jefe', plant: 'montebello' } } as AuthenticatedRequest;
  assert.equal(guard.canActivate(fakeContext(request, { requiredPermission: 'acknowledge_alarms' })), true);
  assert.throws(() => guard.canActivate(fakeContext(request, { requiredPermission: 'control_valves' })), ForbiddenException);
});

test('PermissionGuard: admin permite system_config', () => {
  const guard = new PermissionGuard(new Reflector());
  const request = { user: { id: 'u1', name: 'A', email: 'a@b.com', role: 'admin', plant: 'montebello' } } as AuthenticatedRequest;
  const ctx = fakeContext(request, { requiredPermission: 'system_config' });
  assert.equal(guard.canActivate(ctx), true);
});

test('PermissionGuard: sin request.user (JwtAuthGuard no corrió antes) → UnauthorizedException', () => {
  const guard = new PermissionGuard(new Reflector());
  const ctx = fakeContext({} as AuthenticatedRequest, { requiredPermission: 'view_dashboard' });
  assert.throws(() => guard.canActivate(ctx), UnauthorizedException);
});
