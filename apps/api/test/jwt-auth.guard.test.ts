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

test('JwtAuthGuard: sin Authorization header → UnauthorizedException (401)', () => {
  const guard = new JwtAuthGuard(new Reflector(), new JwtService());
  const ctx = fakeContext({ headers: {} } as AuthenticatedRequest);
  assert.throws(() => guard.canActivate(ctx), UnauthorizedException);
});

test('JwtAuthGuard: token inválido → UnauthorizedException (401)', () => {
  const guard = new JwtAuthGuard(new Reflector(), new JwtService());
  const ctx = fakeContext({ headers: { authorization: 'Bearer no-es-un-jwt' } } as AuthenticatedRequest);
  assert.throws(() => guard.canActivate(ctx), UnauthorizedException);
});

test('JwtAuthGuard: @Public() deja pasar sin token', () => {
  const guard = new JwtAuthGuard(new Reflector(), new JwtService());
  const ctx = fakeContext({ headers: {} } as AuthenticatedRequest, { isPublic: true });
  assert.equal(guard.canActivate(ctx), true);
});

test('JwtAuthGuard: token válido → setea request.user y permite', () => {
  const jwt = new JwtService();
  const token = jwt.sign({ sub: 'u1', email: 'a@b.com', name: 'A', role: 'admin', plant: 'montebello' });
  const guard = new JwtAuthGuard(new Reflector(), jwt);
  const request = { headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest;
  const ctx = fakeContext(request);
  assert.equal(guard.canActivate(ctx), true);
  assert.equal(request.user?.role, 'admin');
  assert.equal(request.user?.id, 'u1');
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
