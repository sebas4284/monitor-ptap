/**
 * Fase 5 — e2e del endpoint POST /api/plants/:plantId/commands (supertest + guards reales):
 *  - sin JWT → 401;
 *  - civil (sin control_valves) → 403;
 *  - operador con sesión segura → 200 confirmado;
 *  - sesión Anonymous/None → 403 WRITES_DISABLED_INSECURE_SESSION.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Role } from '@ptap/shared';
import { AuditLogService } from '../src/infrastructure/audit/audit-log.service';
import { CONNECTIVITY_ADAPTER, CONNECTIVITY_CONFIG } from '../src/infrastructure/connectivity/connectivity.tokens';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import type { PlantSnapshotDto } from '../src/infrastructure/connectivity/pipeline/plant-snapshot.dto';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';
import { UsersRepository, type UserRecord } from '../src/modules/users/users.repository';
import { CommandLogRepository, type StoredCommand } from '../src/modules/commands/command-log.repository';
import { CommandMappingResolver } from '../src/modules/commands/command-mapping.resolver';
import { CommandsController } from '../src/modules/commands/commands.controller';
import { WriteService } from '../src/modules/commands/write.service';
import type { WriteSpec } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-commands-e2e';

const WRITE: WriteSpec = {
  target: { channel: 'intOut', sourceBuffer: 'INT_OUT_TEST', index: 3 },
  commands: { openValve: 1, closeValve: 0 },
  readBack: { channel: 'intOut', sourceBuffer: 'INT_OUT_TEST', index: 3, confirmsWrittenValue: true },
  timeoutMs: 60,
  rollbackValue: 0,
  permission: 'control_valves',
};

function liveSnapshot(): PlantSnapshotDto {
  return {
    plantId: 'voragine', displayName: 'La Vorágine', sequence: 5, protocolVersion: 'v2', dtoVersion: 'v1',
    bridgeStatus: 'Connected', liveness: { state: 'live', lastChangeAt: null, windowSec: 300 }, signals: {},
  } as PlantSnapshotDto;
}

function fakeAdapter(secure: boolean) {
  const store = new Map<string, number | boolean>();
  const key = (t: { plantId: string; channel: string; sourceBuffer: string; index: number }) => `${t.plantId}/${t.channel}/${t.sourceBuffer}[${t.index}]`;
  return {
    getWriteSecurity: () => ({ secure, securityMode: secure ? 'SignAndEncrypt' : 'None', identity: secure ? 'username' : 'anonymous' }),
    getBridgeStatus: () => 'Connected' as const,
    async writeBufferElement(t: never, v: number | boolean) { store.set(key(t), v); },
    async readBufferElement(t: never) { return { value: store.get(key(t)) ?? 0, quality: 'Good' as const, sourceTimestamp: null }; },
  };
}

/** JwtAuthGuard relee al usuario en cada petición; los ids son `u-<rol>` (ver tokenFor). */
const usersDouble = {
  findById: async (id: string): Promise<UserRecord | null> => {
    const role = id.replace(/^u-/, '');
    return {
      id, email: `${role}@ptap.co`, name: role, role, plant: 'voragine',
      passwordHash: 'x', pepperVersion: 1, isActive: true,
    };
  },
} as unknown as UsersRepository;

function fakeRepo(): CommandLogRepository {
  let id = 1;
  return {
    reserve: async () => ({ reserved: true, id: id++ }),
    finalize: async () => undefined,
    findByIdempotencyKey: async () => null as StoredCommand | null,
  } as unknown as CommandLogRepository;
}

async function buildApp(secure: boolean): Promise<{ app: INestApplication; jwt: JwtService }> {
  @Module({
    controllers: [CommandsController],
    providers: [
      WriteService,
      JwtAuthGuard,
      PermissionGuard,
      JwtService,
      { provide: CONNECTIVITY_ADAPTER, useValue: fakeAdapter(secure) },
      { provide: CONNECTIVITY_CONFIG, useValue: { opcua: { writesEnabled: true } } },
      { provide: PlantCache, useValue: { get: () => liveSnapshot() } },
      { provide: CommandMappingResolver, useValue: { resolve: () => ({ domainKey: 'valveEV01', write: WRITE }) } },
      { provide: CommandLogRepository, useValue: fakeRepo() },
      { provide: UsersRepository, useValue: usersDouble },
      { provide: AuditLogService, useValue: { record: async () => undefined } },
    ],
  })
  class CommandsE2eModule {}

  const moduleRef = await Test.createTestingModule({ imports: [CommandsE2eModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return { app, jwt: moduleRef.get(JwtService) };
}

function token(jwt: JwtService, role: Role): string {
  return jwt.sign({ sub: `u-${role}`, email: `${role}@ptap.co`, name: role, role, plant: 'voragine' });
}

const body = { command: 'openValve', target: 'valveEV01' };

test('commands-e2e: sin JWT → 401', async () => {
  const { app } = await buildApp(true);
  try {
    await request(app.getHttpServer()).post('/api/plants/voragine/commands').send(body).expect(401);
  } finally {
    await app.close();
  }
});

test('commands-e2e: civil (sin control_valves) → 403', async () => {
  const { app, jwt } = await buildApp(true);
  try {
    await request(app.getHttpServer())
      .post('/api/plants/voragine/commands')
      .set('Authorization', `Bearer ${token(jwt, 'civil')}`)
      .send(body)
      .expect(403);
  } finally {
    await app.close();
  }
});

test('commands-e2e: operador con sesión segura → 200 confirmado', async () => {
  const { app, jwt } = await buildApp(true);
  try {
    const res = await request(app.getHttpServer())
      .post('/api/plants/voragine/commands')
      .set('Authorization', `Bearer ${token(jwt, 'operador')}`)
      .send(body)
      .expect(200);
    assert.equal(res.body.status, 'confirmed');
    assert.equal(res.body.writtenValue, 1);
  } finally {
    await app.close();
  }
});

test('commands-e2e: sesión Anonymous/None → 403 WRITES_DISABLED_INSECURE_SESSION', async () => {
  const { app, jwt } = await buildApp(false);
  try {
    const res = await request(app.getHttpServer())
      .post('/api/plants/voragine/commands')
      .set('Authorization', `Bearer ${token(jwt, 'operador')}`)
      .send(body)
      .expect(403);
    assert.equal(res.body.reason, 'WRITES_DISABLED_INSECURE_SESSION');
  } finally {
    await app.close();
  }
});
