/**
 * E2E ligero (Fase 4, criterio de aceptación): "sin JWT → 401; permiso insuficiente → 403"
 * probado con requests HTTP reales (@nestjs/testing + supertest) contra un controlador de
 * prueba con rutas por permiso — sin MYSQL_POOL ni AuthController real (login no se prueba
 * aquí, eso es de auth.service, no de los guards).
 *
 * El caso central es `jefe`: la matriz oficial le da todo lo del operador SALVO abrir/cerrar
 * válvulas. El modelo de permisos (ROLE_PERMISSIONS de @ptap/shared) lo expresa; el antiguo
 * tier lineal no podía. Aquí se prueba: jefe → 403 en control_valves, 200 en acknowledge_alarms.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import { Controller, Get, INestApplication, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Role } from '@ptap/shared';
import { RequirePermission } from '../src/modules/auth/decorators/require-permission.decorator';
import { Public } from '../src/modules/auth/decorators/public.decorator';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-rbac-e2e';

@Controller('probe')
@UseGuards(JwtAuthGuard, PermissionGuard)
class ProbeController {
  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }

  /** Sin @RequirePermission: cualquier rol autenticado (equivale al antiguo tier viewer). */
  @Get('open')
  openRoute() {
    return { ok: true };
  }

  @Get('valves')
  @RequirePermission('control_valves')
  valvesRoute() {
    return { ok: true };
  }

  @Get('ack-alarms')
  @RequirePermission('acknowledge_alarms')
  ackAlarmsRoute() {
    return { ok: true };
  }

  @Get('admin')
  @RequirePermission('system_config')
  adminRoute() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController], providers: [JwtAuthGuard, PermissionGuard, JwtService] })
class ProbeModule {}

async function buildApp(): Promise<{ app: INestApplication; jwt: JwtService }> {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, jwt: moduleRef.get(JwtService) };
}

function tokenFor(jwt: JwtService, role: Role): string {
  return jwt.sign({ sub: `u-${role}`, email: `${role}@ptap.co`, name: role, role, plant: 'montebello' });
}

test('rbac-e2e: ruta @Public() responde 200 sin token', async () => {
  const { app } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/probe/public').expect(200);
  } finally {
    await app.close();
  }
});

test('rbac-e2e: ruta protegida sin Authorization → 401', async () => {
  const { app } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/probe/open').expect(401);
    await request(app.getHttpServer()).get('/probe/admin').expect(401);
  } finally {
    await app.close();
  }
});

test('rbac-e2e: ruta sin @RequirePermission → 200 con cualquier rol autenticado (incl. civil)', async () => {
  const { app, jwt } = await buildApp();
  try {
    for (const role of ['civil', 'operador', 'jefe', 'admin'] as Role[]) {
      await request(app.getHttpServer()).get('/probe/open').set('Authorization', `Bearer ${tokenFor(jwt, role)}`).expect(200);
    }
  } finally {
    await app.close();
  }
});

test('rbac-e2e: permiso insuficiente (civil pide system_config) → 403; admin → 200', async () => {
  const { app, jwt } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/probe/admin').set('Authorization', `Bearer ${tokenFor(jwt, 'civil')}`).expect(403);
    await request(app.getHttpServer()).get('/probe/admin').set('Authorization', `Bearer ${tokenFor(jwt, 'admin')}`).expect(200);
  } finally {
    await app.close();
  }
});

// El caso que motivó migrar de tiers a permisos: jefe = operador MENOS control_valves.
test('rbac-e2e: jefe → 403 en control_valves pero 200 en acknowledge_alarms', async () => {
  const { app, jwt } = await buildApp();
  try {
    const jefe = `Bearer ${tokenFor(jwt, 'jefe')}`;
    await request(app.getHttpServer()).get('/probe/valves').set('Authorization', jefe).expect(403);
    await request(app.getHttpServer()).get('/probe/ack-alarms').set('Authorization', jefe).expect(200);
  } finally {
    await app.close();
  }
});

test('rbac-e2e: operador → 200 en control_valves y en acknowledge_alarms', async () => {
  const { app, jwt } = await buildApp();
  try {
    const operador = `Bearer ${tokenFor(jwt, 'operador')}`;
    await request(app.getHttpServer()).get('/probe/valves').set('Authorization', operador).expect(200);
    await request(app.getHttpServer()).get('/probe/ack-alarms').set('Authorization', operador).expect(200);
  } finally {
    await app.close();
  }
});
