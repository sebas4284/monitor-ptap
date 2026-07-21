/**
 * Ámbito por planta. La regla que fija este test: una cuenta solo alcanza SU planta
 * (`user.plant`), salvo con `view_all_plants` (hoy solo Admin).
 *
 * El caso que de verdad protege es la ESCRITURA: sin este guard, un operador de Montebello
 * podía mandar `POST /api/plants/voragine/commands` y accionar equipo de otra planta. Que hoy
 * las escrituras estén apagadas por `OPCUA_WRITES_ENABLED=false` no es un control de acceso:
 * es un interruptor que algún día se encenderá.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Role } from '@ptap/shared';
import { PlantScopeGuard } from '../src/modules/auth/guards/plant-scope.guard';
import type { AuthenticatedRequest } from '../src/modules/auth/authenticated-request';

function contextFor(params: Record<string, string>, user?: { role: Role; plant: string }): ExecutionContext {
  const request = {
    params,
    user: user ? { id: 'u1', name: 'U', email: 'u@ptap.co', role: user.role, plant: user.plant } : undefined,
  } as unknown as AuthenticatedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const guard = new PlantScopeGuard();

test('plant-scope: el operador accede a SU planta', () => {
  const ctx = contextFor({ plantId: 'montebello' }, { role: 'operador', plant: 'montebello' });
  assert.equal(guard.canActivate(ctx), true);
});

test('plant-scope: el operador NO accede a otra planta → 403', () => {
  const ctx = contextFor({ plantId: 'voragine' }, { role: 'operador', plant: 'montebello' });
  assert.throws(() => guard.canActivate(ctx), ForbiddenException);
});

test('plant-scope: el jefe tampoco cruza de planta → 403', () => {
  const ctx = contextFor({ plantId: 'voragine' }, { role: 'jefe', plant: 'montebello' });
  assert.throws(() => guard.canActivate(ctx), ForbiddenException);
});

test('plant-scope: el civil tampoco cruza de planta → 403', () => {
  const ctx = contextFor({ plantId: 'voragine' }, { role: 'civil', plant: 'montebello' });
  assert.throws(() => guard.canActivate(ctx), ForbiddenException);
});

test('plant-scope: el admin (view_all_plants) accede a cualquier planta', () => {
  const ctx = contextFor({ plantId: 'voragine' }, { role: 'admin', plant: 'montebello' });
  assert.equal(guard.canActivate(ctx), true);
});

test('plant-scope: ruta SIN :plantId es no-op (p. ej. el listado de plantas)', () => {
  const ctx = contextFor({}, { role: 'operador', plant: 'montebello' });
  assert.equal(guard.canActivate(ctx), true);
});

test('plant-scope: sin usuario en la petición → 401 (JwtAuthGuard no corrió antes)', () => {
  const ctx = contextFor({ plantId: 'montebello' });
  assert.throws(() => guard.canActivate(ctx), UnauthorizedException);
});
