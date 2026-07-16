/**
 * AuditMiddleware (Fase 4, ajuste de cierre): audita accesos a rutas protegidas — permitidos
 * Y denegados — enganchando res.on('finish'). El punto clave frente al antiguo interceptor:
 * un 403 (rechazado por PermissionGuard) SÍ queda auditado, con el usuario que JwtAuthGuard
 * ya había seteado. Se prueba con app Nest real + supertest y un AuditLogService stubeado.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controller, Get, INestApplication, MiddlewareConsumer, Module, NestModule, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Role } from '@ptap/shared';
import { AuditLogService, type AuditEntry } from '../src/infrastructure/audit/audit-log.service';
import { AuditMiddleware } from '../src/infrastructure/audit/audit.middleware';
import { RequirePermission } from '../src/modules/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-audit-mw';

// Rutas bajo /api/plants (prefijo auditado) para ejercitar el filtro del middleware.
@Controller('plants')
@UseGuards(JwtAuthGuard, PermissionGuard)
class AuditedController {
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('admin')
  @RequirePermission('system_config')
  admin() {
    return { ok: true };
  }
}

// /api/health NO debe auditarse (no empieza por un prefijo auditado).
@Controller('health')
class HealthProbeController {
  @Get()
  health() {
    return { ok: true };
  }
}

async function buildApp(): Promise<{ app: INestApplication; jwt: JwtService; records: AuditEntry[] }> {
  const records: AuditEntry[] = [];
  const auditStub: Pick<AuditLogService, 'record'> = {
    record: async (entry: AuditEntry) => {
      records.push(entry);
    },
  };

  @Module({
    controllers: [AuditedController, HealthProbeController],
    providers: [JwtAuthGuard, PermissionGuard, JwtService, AuditMiddleware, { provide: AuditLogService, useValue: auditStub }],
  })
  class AuditProbeModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(AuditMiddleware).forRoutes('*');
    }
  }

  const moduleRef = await Test.createTestingModule({ imports: [AuditProbeModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return { app, jwt: moduleRef.get(JwtService), records };
}

function tokenFor(jwt: JwtService, role: Role): string {
  return jwt.sign({ sub: `u-${role}`, email: `${role}@ptap.co`, name: role, role, plant: 'montebello' });
}

/** Espera a que corra el handler de res.on('finish') + el record() fire-and-forget. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('audit-middleware: acceso PERMITIDO (200) queda auditado con el usuario', async () => {
  const { app, jwt, records } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/api/plants/admin').set('Authorization', `Bearer ${tokenFor(jwt, 'admin')}`).expect(200);
    await settle();
    assert.equal(records.length, 1);
    const rec = records[0];
    assert.equal(rec.eventType, 'http.request');
    assert.equal(rec.role, 'admin');
    assert.equal(rec.statusCode, 200);
    assert.equal(rec.method, 'GET');
    assert.equal(rec.path, '/api/plants/admin');
    assert.equal(rec.userEmail, 'admin@ptap.co');
    assert.ok(rec.ip);
  } finally {
    await app.close();
  }
});

// El objetivo del ajuste: un 403 SÍ se audita, y con el usuario denegado (lo setea JwtAuthGuard).
test('audit-middleware: acceso DENEGADO (403) queda auditado con el usuario denegado', async () => {
  const { app, jwt, records } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/api/plants/admin').set('Authorization', `Bearer ${tokenFor(jwt, 'civil')}`).expect(403);
    await settle();
    assert.equal(records.length, 1);
    const rec = records[0];
    assert.equal(rec.statusCode, 403);
    assert.equal(rec.role, 'civil');
    assert.equal(rec.userEmail, 'civil@ptap.co');
    assert.equal(rec.path, '/api/plants/admin');
  } finally {
    await app.close();
  }
});

test('audit-middleware: sin token (401) se audita con usuario nulo', async () => {
  const { app, records } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/api/plants/admin').expect(401);
    await settle();
    assert.equal(records.length, 1);
    assert.equal(records[0].statusCode, 401);
    assert.equal(records[0].role, null);
    assert.equal(records[0].userId, null);
  } finally {
    await app.close();
  }
});

test('audit-middleware: /api/health NO se audita (fuera de los prefijos protegidos)', async () => {
  const { app, records } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/api/health').expect(200);
    await settle();
    assert.equal(records.length, 0);
  } finally {
    await app.close();
  }
});
