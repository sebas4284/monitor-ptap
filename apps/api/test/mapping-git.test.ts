import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { exportMappingToGit, MappingGitService } from '../src/modules/mapping/mapping-git.service';
import { MappingWriteLock } from '../src/modules/mapping/mapping-write-lock';
import { MappingController } from '../src/modules/mapping/mapping.controller';
import { MappingOverrideService } from '../src/modules/mapping/mapping-override.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';
import { UsersRepository } from '../src/modules/users/users.repository';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { MappingOverride } from '../src/infrastructure/connectivity/mapping/mapping-overrides';

const execute = promisify(execFile);
const mappingFile = 'apps/api/config/opc_mapping.json';
const schemaFile = 'apps/api/config/opc_mapping.schema.json';
const source = resolve(__dirname, '..', 'config');

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'ptap-mapping-git-test-'));
  const repo = join(temporary, 'repo');
  const remote = join(temporary, 'remote.git');
  await mkdir(join(repo, 'apps/api/config'), { recursive: true });
  const git = async (cwd: string, args: string[]) => (await execute('git', args, {
    cwd, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  })).stdout.trim();
  await writeFile(join(repo, mappingFile), await readFile(join(source, 'opc_mapping.json')));
  await writeFile(join(repo, schemaFile), await readFile(join(source, 'opc_mapping.schema.json')));
  await git(repo, ['init', '-b', 'yosh']);
  await git(repo, ['config', 'user.name', 'Mapping test']);
  await git(repo, ['config', 'user.email', 'mapping@example.test']);
  await git(repo, ['add', '--', mappingFile, schemaFile]);
  await git(repo, ['commit', '-m', 'fixture']);
  await git(temporary, ['init', '--bare', remote]);
  await git(repo, ['push', remote, 'yosh']);
  const base = loadMapping(join(repo, mappingFile));
  const signal = base.signals.find((s) => !s.writable && s.mappingStatus === 'mapped' && s.unit !== 'bar');
  assert.ok(signal);
  const overrides: MappingOverride[] = [{ plantId: signal.plantId, domainKey: signal.domainKey, patch: { unit: 'bar' }, by: 'admin', at: null }];
  const config = { repoPath: repo, remote, name: 'Mapping test', email: 'mapping@example.test' };
  return { temporary, repo, remote, base, signal, overrides, config, git, cleanup: () => rm(temporary, { recursive: true, force: true }) };
}

test('mapping git: publica sólo el JSON en yosh de un bare LOCAL y conserva checkout y overrides', async () => {
  const f = await fixture();
  try {
    const original = await readFile(join(f.repo, mappingFile), 'utf8');
    const overrides = structuredClone(f.overrides);
    const result = await exportMappingToGit(f.config, f.base, f.overrides);
    assert.equal(result.status, 'publicado');
    assert.match(result.commit!, /^[a-f0-9]{40,64}$/);
    assert.equal(await f.git(f.remote, ['show', '--format=', '--name-only', 'yosh']), mappingFile);
    const published = JSON.parse(await f.git(f.remote, ['show', `yosh:${mappingFile}`]));
    const signal = published.plants.find((p: { plantId: string }) => p.plantId === f.signal.plantId)
      .signals.find((s: { domainKey: string }) => s.domainKey === f.signal.domainKey);
    assert.equal(signal.unit, 'bar');
    assert.equal(signal.confidence, 'inferred');
    assert.equal(await readFile(join(f.repo, mappingFile), 'utf8'), original);
    assert.equal(await f.git(f.repo, ['status', '--porcelain']), '');
    assert.deepEqual(f.overrides, overrides);
    await assert.rejects(exportMappingToGit(f.config, f.base, f.overrides), (error: unknown) =>
      JSON.stringify(error).includes('GIT_DESACTUALIZADO'));
  } finally { await f.cleanup(); }
});

test('mapping git: un push rechazado conserva rama, archivo, índice y overrides', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    const before = await f.git(f.repo, ['rev-parse', 'HEAD']);
    const original = await readFile(join(f.repo, mappingFile), 'utf8');
    await assert.rejects(exportMappingToGit(f.config, f.base, f.overrides), /Git no completó/);
    assert.equal(await f.git(f.repo, ['rev-parse', 'HEAD']), before);
    assert.equal(await f.git(f.remote, ['rev-parse', 'yosh']), before);
    assert.equal(await readFile(join(f.repo, mappingFile), 'utf8'), original);
    assert.equal(await f.git(f.repo, ['status', '--porcelain']), '');
    assert.equal(f.overrides[0].patch.unit, 'bar');
  } finally { await f.cleanup(); }
});

test('mapping git: rechaza cambios ajenos, staged y no versionados sin modificarlos', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, 'ajeno.txt'), 'conservar');
    for (const staged of [false, true]) {
      if (staged) await f.git(f.repo, ['add', '--', 'ajeno.txt']);
      const status = await f.git(f.repo, ['status', '--porcelain']);
      await assert.rejects(exportMappingToGit(f.config, f.base, f.overrides), (error: unknown) => JSON.stringify(error).includes('GIT_SUCIO'));
      assert.equal(await f.git(f.repo, ['status', '--porcelain']), status);
      assert.equal(await readFile(join(f.repo, 'ajeno.txt'), 'utf8'), 'conservar');
    }
  } finally { await f.cleanup(); }
});

test('mapping git: valida schema, semántica y base runtime antes de publicar', async () => {
  const f = await fixture();
  try {
    const before = await f.git(f.remote, ['rev-parse', 'yosh']);
    for (const patch of [{ index: 10000 }, { min: 100, max: 1 }, { typo: 2 }, { unit: '' }]) {
      await assert.rejects(exportMappingToGit(f.config, f.base, [{ ...f.overrides[0], patch }]));
    }
    const base = { ...f.base, raw: { incorrecto: true } };
    await assert.rejects(exportMappingToGit(f.config, base, f.overrides), (error: unknown) => JSON.stringify(error).includes('GIT_BASE_DISTINTA'));
    assert.equal(await f.git(f.remote, ['rev-parse', 'yosh']), before);
    assert.equal(await f.git(f.repo, ['status', '--porcelain']), '');
    assert.deepEqual(await exportMappingToGit(f.config, f.base, []), { status: 'sin_cambios', commit: null, branch: 'yosh' });
  } finally { await f.cleanup(); }
});

test('mapping git: exclusión del mismo repo y de ediciones/reversiones durante la publicación', async () => {
  const f = await fixture();
  try {
    const attempts = await Promise.allSettled([
      exportMappingToGit(f.config, f.base, f.overrides), exportMappingToGit(f.config, f.base, f.overrides),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(attempts.some((r) => r.status === 'rejected' && JSON.stringify(r.reason).includes('GIT_OCUPADO')));
    const lock = new MappingWriteLock();
    let unlock!: () => void;
    const pending = lock.run(() => new Promise<void>((resolve) => { unlock = resolve; }));
    await assert.rejects(lock.run(async () => undefined), /Hay otra edición/);
    const overrides = new MappingOverrideService({} as never, {} as never, lock);
    await assert.rejects(overrides.aplicar('cascajal', 'inletPressure1', { unit: 'bar' }, undefined), /Hay otra edición/);
    await assert.rejects(overrides.revertir('cascajal', 'inletPressure1', undefined), /Hay otra edición/);
    unlock();
    await pending;
    await lock.run(async () => undefined);
  } finally { await f.cleanup(); }
});

test('mapping git: schema obligatorio y rechazo estructural sin tocar el remoto', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, schemaFile), JSON.stringify({ not: {} }));
    await f.git(f.repo, ['add', '--', schemaFile]);
    await f.git(f.repo, ['commit', '-m', 'schema fixture rechaza todo']);
    await f.git(f.repo, ['push', f.remote, 'yosh']);
    const before = await f.git(f.remote, ['rev-parse', 'yosh']);
    await assert.rejects(exportMappingToGit(f.config, f.base, f.overrides), (error: unknown) => JSON.stringify(error).includes('SCHEMA_INVALIDO'));
    await f.git(f.repo, ['rm', '--', schemaFile]);
    await f.git(f.repo, ['commit', '-m', 'schema fixture ausente']);
    await f.git(f.repo, ['push', f.remote, 'yosh']);
    const missingSchemaHead = await f.git(f.remote, ['rev-parse', 'yosh']);
    assert.notEqual(missingSchemaHead, before);
    await assert.rejects(exportMappingToGit(f.config, f.base, f.overrides), /ENOENT/);
    assert.equal(await f.git(f.remote, ['rev-parse', 'yosh']), missingSchemaHead);
    assert.equal(await f.git(f.repo, ['status', '--porcelain']), '');
  } finally { await f.cleanup(); }
});

test('mapping git: POST real exige JWT y system_config; servicio deshabilitado por defecto', async () => {
  const previous = process.env.MAPPING_GIT_ENABLED;
  const previousRemote = process.env.MAPPING_GIT_REMOTE;
  delete process.env.MAPPING_GIT_ENABLED;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'mapping-git-test-secret';
  const lock = new MappingWriteLock();
  const service = new MappingGitService({} as never, {} as never, lock);
  const module = await Test.createTestingModule({
    controllers: [MappingController],
    providers: [JwtAuthGuard, PermissionGuard, JwtService,
      { provide: MappingOverrideService, useValue: {} },
      { provide: MappingGitService, useValue: service },
      { provide: UsersRepository, useValue: { findById: async (role: string) => ({ id: role, role, email: `${role}@example.test`, name: role, plant: 'montebello', isActive: true, emailVerified: true }) } },
    ],
  }).compile();
  const app = module.createNestApplication();
  try {
    app.setGlobalPrefix('api');
    await app.init();
    const jwt = module.get(JwtService);
    await request(app.getHttpServer()).post('/api/opc/mapping/git').expect(401);
    for (const role of ['civil', 'operador', 'jefe', 'admin'] as const) {
      const token = jwt.sign({ sub: role, email: `${role}@example.test`, name: role, role, plant: 'montebello' });
      const result = await request(app.getHttpServer()).post('/api/opc/mapping/git')
        .set('Authorization', `Bearer ${token}`).send({ remote: '/tmp/ignored', branch: 'main' }).expect(role === 'admin' ? 503 : 403);
      if (role === 'admin') assert.equal(result.body.motivo, 'GIT_DESHABILITADO');
    }
    process.env.MAPPING_GIT_ENABLED = 'true';
    process.env.MAPPING_GIT_REMOTE = '/tmp/remoto-local-prohibido-en-api';
    await assert.rejects(service.publicar(), /Falta la configuración/);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.MAPPING_GIT_ENABLED;
    else process.env.MAPPING_GIT_ENABLED = previous;
    if (previousRemote === undefined) delete process.env.MAPPING_GIT_REMOTE;
    else process.env.MAPPING_GIT_REMOTE = previousRemote;
  }
});
