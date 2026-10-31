import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'mysql2/promise';
import { CommandSignatureService } from '../src/modules/commands/command-signature.service';
import { CommandCheckpointStore } from '../src/modules/commands/command-checkpoint.store';
import { CommandSignatureController } from '../src/modules/commands/command-signature.controller';
import { SignatureIntegrityDetector } from '../src/modules/commands/signature-integrity.detector';
import type { NewNotification, NotificationRepository } from '../src/modules/notifications/notification.repository';
import { parseBaselineArgs } from '../scripts/accept-command-ledger-baseline';
import { parseLegacyBoundaryArgs } from '../scripts/accept-command-legacy-boundary';
import { legacyFactsDigest, type LegacyRow } from '../src/modules/commands/command-legacy-boundary';
import { sellar } from '../src/modules/commands/command-signature';

async function baseline(path: string) {
  const store = new CommandCheckpointStore('synthetic-ledger-secret', path);
  await store.exclusive(() => store.write({ version: 1, count: 0, tip: null, last: null }));
}

type Row = Record<string, unknown>;
function row(id: number): Row {
  return { id, at: '2026-10-30T12:00:00Z', plant_id: 'voragine', target: 'valve1',
    command: 'open', status: 'confirmed', user_id: null, user_name: null, user_email: null,
    role: null, written_value: null, confirmed_value: null, signature: null, prev_signature: null };
}

// Only the external SQL boundary is substituted. Transactions preserve rollback semantics;
// signing, verification, HMAC and checkpoint IO are the actual production implementations.
function database(rows: Row[], commit: () => Promise<void> = async () => {}) {
  let backup: Row[] = [];
  const query = async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith('UPDATE command_log SET user_name')) {
      const found = rows.find((r) => r.id === args[1]);
      if (found) found.user_name = args[0];
      return [{}];
    }
    if (sql.startsWith('UPDATE command_log SET signature')) {
      const found = rows.find((r) => r.id === args[2]);
      if (found) Object.assign(found, { signature: args[0], prev_signature: args[1] });
      return [{}];
    }
    if (/COUNT\(\*\)/i.test(sql)) return [[{ count: rows.filter((r) => r.signature !== null).length }]];
    if (!sql.trim().startsWith('SELECT')) throw new Error(`Unexpected SQL: ${sql}`);
    let found = [...rows];
    if (/WHERE id = \?/.test(sql)) found = found.filter((r) => r.id === args[0]);
    if (/WHERE signature = \?/.test(sql)) found = found.filter((r) => r.signature === args[0]);
    if (/signature IS NOT NULL/.test(sql)) found = found.filter((r) => r.signature !== null);
    if (/ORDER BY id DESC/.test(sql)) found.sort((a, b) => Number(b.id) - Number(a.id));
    if (/LIMIT 1/.test(sql)) found = found.slice(0, 1);
    return [found.map((r) => ({ ...r }))];
  };
  return { query, getConnection: async () => ({ query,
    beginTransaction: async () => { backup = structuredClone(rows); },
    commit: async () => { backup = structuredClone(rows); await commit(); },
    rollback: async () => { rows.splice(0, rows.length, ...backup); }, release() {},
  }) } as unknown as Pool;
}

async function fixture(run: (service: CommandSignatureService, rows: Row[], path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'ptap-ledger-'));
  const oldPath = process.env.COMMAND_CHECKPOINT_PATH;
  const oldSecret = process.env.COMMAND_SIGNING_SECRET;
  process.env.COMMAND_CHECKPOINT_PATH = join(dir, 'checkpoint.json');
  process.env.COMMAND_SIGNING_SECRET = 'synthetic-ledger-secret';
  const rows: Row[] = [];
  try { await run(new CommandSignatureService(database(rows)), rows, process.env.COMMAND_CHECKPOINT_PATH); }
  finally {
    if (oldPath === undefined) delete process.env.COMMAND_CHECKPOINT_PATH; else process.env.COMMAND_CHECKPOINT_PATH = oldPath;
    if (oldSecret === undefined) delete process.env.COMMAND_SIGNING_SECRET; else process.env.COMMAND_SIGNING_SECRET = oldSecret;
    await rm(dir, { recursive: true, force: true });
  }
}

test('missing external checkpoint never certifies even an empty database', () => fixture(async (s) => {
  assert.equal((await s.verificar()).verificable, false);
}));

test('missing checkpoint never silently establishes a baseline during signing', () => fixture(async (s, rows) => {
  rows.push(row(1));
  assert.equal(await s.firmar(1, null), null);
  assert.equal(rows[0].signature, null);
}));

test('unsigned rows are reported even with an accepted empty baseline', () => fixture(async (s, rows, path) => {
  await baseline(path);
  rows.push(row(1));
  const result = await s.verificar();
  assert.ok(result.rotos.some((r) => r.id === 1 && String(r.motivo) === 'firma_ausente'));
}));

test('a legitimate pending reservation does not raise a false integrity alarm', () => fixture(async (s, rows, path) => {
  await baseline(path);
  rows.push({ ...row(1), status: 'pending' });
  const result = await s.verificar();
  assert.equal(result.verificable, true);
  assert.deepEqual(result.rotos, []);
  rows[0].status = 'confirmed';
  assert.ok((await s.verificar()).rotos.some((r) => r.motivo === 'firma_ausente'));
}));

test('changing a previously anchored command to unsigned pending cannot hide its removal', () => fixture(async (s, rows, path) => {
  await baseline(path); rows.push(row(1)); await s.firmar(1, null);
  rows[0].signature = null;
  rows[0].status = 'pending';
  assert.ok((await s.verificar()).rotos.some((r) => r.motivo === 'checkpoint_no_coincide'));
}));

test('baseline acceptance rejects pending reservations as well as completed unsigned rows', () => fixture(async (s, rows) => {
  rows.push({ ...row(1), status: 'pending' });
  await assert.rejects(s.establecerBaseline(0, null, 'ACEPTO EL HISTORICO REVISADO'));
  assert.equal((await s.verificar()).verificable, false);
}));

test('baseline acceptance rejects even a pending row with a valid HMAC', () => fixture(async (s, rows, path) => {
  await baseline(path); rows.push({ ...row(1), status: 'pending' });
  rows[0].signature = sellar(asLegacy(rows[0]), null, 'synthetic-ledger-secret');
  await unlink(path);
  await assert.rejects(s.establecerBaseline(1, rows[0].signature as string, 'ACEPTO EL HISTORICO REVISADO'));
}));

for (const attack of ['unsigned', 'tail', 'all'] as const) {
  test(`${attack} deletion cannot be certified as intact`, () => fixture(async (s, rows, path) => {
    await baseline(path);
    rows.push(row(1));
    assert.ok(await s.firmar(1, 'Ana'));
    rows.push(row(2));
    assert.ok(await s.firmar(2, 'Bea'));
    assert.equal((await s.verificar()).rotos.length, 0);
    if (attack === 'unsigned') rows[1].signature = null;
    if (attack === 'tail') rows.pop();
    if (attack === 'all') rows.splice(0);
    const result = await s.verificar();
    assert.ok(result.rotos.length > 0 || !result.verificable);
  }));
}

test('checkpoint advances durably and signing order need not match command ids', () => fixture(async (s, rows, path) => {
  await baseline(path);
  rows.push({ ...row(1), status: 'pending' }, { ...row(2), status: 'pending' });
  const signed = await Promise.all([s.firmar(2, null, async () => { rows[1].status = 'confirmed'; }), s.firmar(1, null, async () => { rows[0].status = 'confirmed'; })]);
  assert.ok(signed.every(Boolean));
  const result = await s.verificar();
  assert.equal(result.verificable, true);
  assert.deepEqual(result.rotos, []);
  const checkpoint = await new CommandCheckpointStore('synthetic-ledger-secret', path).read();
  assert.equal(checkpoint.count, 2);
  assert.equal(checkpoint.tip, rows[0].signature);
  assert.equal(await s.firmar(1, null), signed[1], 'repeated completion is idempotent');
  assert.equal((await new CommandCheckpointStore('synthetic-ledger-secret', path).read()).count, 2);
}));

test('malformed or forged checkpoint is unverified and cannot be replaced by signing', () => fixture(async (s, rows, path) => {
  await writeFile(path, '{"checkpoint":{"version":1,"count":0,"tip":null,"last":null},"mac":"forged"}');
  rows.push(row(1));
  assert.equal((await s.verificar()).verificable, false);
  assert.equal(await s.firmar(1, null), null);
}));

test('checkpoint uncertainty is described without claiming a missing secret', () => fixture(async (s) => {
  const result = await new CommandSignatureController(s).verify();
  assert.equal(result.integra, false);
  assert.match(result.mensaje, /checkpoint|evidencia|verific/i);
  assert.doesNotMatch(result.mensaje, /No hay secreto/);
}));

test('complete deletion alerts using the external checkpoint plant evidence', () => fixture(async (s, rows, path) => {
  await baseline(path); rows.push(row(1)); await s.firmar(1, null); rows.splice(0);
  const published: NewNotification[] = [];
  const repo = { create: async (n: NewNotification) => { published.push(n); return true; } } as unknown as NotificationRepository;
  assert.equal(await new SignatureIntegrityDetector(s, repo).sweep(), 1);
  assert.equal(published[0].plantId, 'voragine');
  assert.match(published[0].message, /checkpoint|control externo|faltan|faltante/i);
}));

test('explicit baseline requires independent expected facts and cannot overwrite existing evidence', () => fixture(async (s, rows, path) => {
  await assert.rejects(s.establecerBaseline(0, null, 'yes'));
  await assert.rejects(s.establecerBaseline(1, null, 'ACEPTO EL HISTORICO REVISADO'));
  assert.equal((await s.verificar()).verificable, false);
  await s.establecerBaseline(0, null, 'ACEPTO EL HISTORICO REVISADO');
  assert.equal((await s.verificar()).verificable, true);
  await assert.rejects(s.establecerBaseline(0, null, 'ACEPTO EL HISTORICO REVISADO'));
  const original = await readFile(path, 'utf8');
  rows.push(row(1));
  await assert.rejects(s.establecerBaseline(0, null, 'ACEPTO EL HISTORICO REVISADO'));
  assert.equal(await readFile(path, 'utf8'), original);
}));

test('an unsigned historical row cannot be accepted as a baseline', () => fixture(async (s, rows) => {
  rows.push(row(1));
  await assert.rejects(s.establecerBaseline(0, null, 'ACEPTO EL HISTORICO REVISADO'));
  assert.equal((await s.verificar()).verificable, false);
}));

test('a stranded or contended host lock never falls back to unlocked signing', () => fixture(async (s, rows, path) => {
  await baseline(path); rows.push(row(1)); await writeFile(`${path}.lock`, 'operator review needed');
  assert.equal(await s.firmar(1, null), null);
  assert.equal(rows[0].signature, null);
  assert.equal((await s.verificar()).verificable, false);
  await unlink(`${path}.lock`);
  assert.ok(await s.firmar(1, null));
}));

test('a SQL commit followed by checkpoint replacement failure remains unverified', () => fixture(async (s, rows, path) => {
  await baseline(path); rows.push(row(1));
  const failing = new CommandSignatureService(database(rows, async () => {
    await unlink(path); await mkdir(path);
  }));
  assert.equal(await failing.firmar(1, null), null);
  assert.equal(typeof rows[0].signature, 'string', 'the physical command and SQL commit already happened');
  assert.equal((await s.verificar()).verificable, false);
  assert.equal(await s.firmar(1, null), null);
}));

test('failed SQL connection does not throw into the physical command path', () => fixture(async (_s, _rows, path) => {
  await baseline(path);
  const failing = new CommandSignatureService({ getConnection: async () => { throw new Error('offline'); } } as unknown as Pool);
  assert.equal(await failing.firmar(1, null), null);
}));

test('baseline CLI requires an exact count, trusted tip and deliberate acceptance', () => {
  assert.deepEqual(parseBaselineArgs(['--count=0', '--tip=GENESIS', '--accept-reviewed-history']), { count: 0, tip: null });
  assert.deepEqual(parseBaselineArgs(['--count=2', `--tip=${'a'.repeat(64)}`, '--accept-reviewed-history']), { count: 2, tip: 'a'.repeat(64) });
  for (const args of [[], ['--count=0', '--tip=GENESIS'],
    ['--count=-1', '--tip=GENESIS', '--accept-reviewed-history'],
    ['--count=1', '--tip=GENESIS', '--accept-reviewed-history'],
    ['--count=0', `--tip=${'a'.repeat(64)}`, '--accept-reviewed-history'],
    ['--count=2', '--tip=broken', '--accept-reviewed-history']]) {
    assert.throws(() => parseBaselineArgs(args));
  }
});

function asLegacy(r: Row): LegacyRow {
  return { id: Number(r.id), at: new Date(String(r.at)).toISOString(), plantId: String(r.plant_id), target: String(r.target),
    command: String(r.command), status: String(r.status), userId: r.user_id as string | null, userName: r.user_name as string | null,
    userEmail: r.user_email as string | null, role: r.role as string | null, writtenValue: r.written_value as string | null,
    confirmedValue: r.confirmed_value as string | null, signature: r.signature as string | null, prevSignature: r.prev_signature as string | null };
}
async function mixedLegacy(s: CommandSignatureService, rows: Row[]) {
  rows.push(row(1), row(2));
  rows[1].signature = sellar(asLegacy(rows[1]), null, 'synthetic-ledger-secret');
  const expected = { total: 2, unsigned: 1, count: 1, tip: rows[1].signature as string, factsSha256: legacyFactsDigest(rows.map(asLegacy)) };
  await s.establecerFronteraLegacy(expected, 'ACEPTO LA FRONTERA LEGACY SIN AUTENTICIDAD RETROACTIVA');
  return expected;
}

test('reviewed mixed legacy is preserved without re-signing and future commands continue original chain', () => fixture(async (s, rows, path) => {
  const expected = await mixedLegacy(s, rows);
  const original = structuredClone(rows);
  const manifestBytes = await readFile(`${path}.legacy-boundary.json`, 'utf8');
  const result = await new CommandSignatureController(s).verify();
  assert.equal(result.verificable, true); assert.equal(result.integra, false);
  assert.deepEqual(result.rotos, []);
  assert.deepEqual(result.legado, { total: 2, sinFirma: 1, conservado: true, autenticidad: 'no_demostrada' });
  assert.deepEqual(result.desdeActivacion, { firmadas: 0, verificable: true, integra: true });
  assert.match(result.mensaje, /siguen sin firma.*no está demostrada/);
  assert.equal(await s.firmar(1, 'Must not change'), null, 'original unsigned identity cannot acquire a retrospective seal');
  assert.deepEqual(rows, original);
  rows.push(row(3));
  assert.ok(await s.firmar(3, 'Synthetic operator'));
  assert.equal(rows[2].prev_signature, expected.tip);
  assert.deepEqual(rows.slice(0, 2), original);
  assert.equal((await s.verificar()).desdeActivacion?.firmadas, 1);
  assert.equal((await s.verificar()).desdeActivacion?.integra, true);
  assert.equal((await new CommandSignatureController(s).verify()).integra, false);
  assert.equal(await readFile(`${path}.legacy-boundary.json`, 'utf8'), manifestBytes, 'manifest remains immutable while checkpoint advances');
  const anchor = await new CommandCheckpointStore('synthetic-ledger-secret', path).read();
  assert.equal(anchor.version, 2); assert.equal(anchor.count, 2);
}));

test('known accepted unsigned legacy does not send tamper alerts, new unsigned completion does', () => fixture(async (s, rows) => {
  await mixedLegacy(s, rows);
  const published: NewNotification[] = [];
  const repo = { create: async (n: NewNotification) => { published.push(n); return true; } } as unknown as NotificationRepository;
  const detector = new SignatureIntegrityDetector(s, repo);
  assert.equal(await detector.sweep(), 0);
  rows.push({ ...row(3), status: 'pending' });
  assert.equal(await detector.sweep(), 0);
  rows[2].status = 'confirmed';
  assert.equal(await detector.sweep(), 1);
  assert.match(published[0].message, /sin firma válida/);
  assert.equal((await s.verificar()).desdeActivacion?.integra, false);
}));

for (const attack of ['unsigned_edit', 'unsigned_delete', 'unsigned_resign', 'unsigned_pending', 'signed_delete', 'all_delete', 'old_id_insert'] as const) {
  test(`legacy boundary detects ${attack} and blocks signing new commands`, () => fixture(async (s, rows) => {
    await mixedLegacy(s, rows);
    if (attack === 'unsigned_edit') rows[0].user_name = 'Forged';
    if (attack === 'unsigned_delete') rows.splice(0, 1);
    if (attack === 'unsigned_resign') rows[0].signature = sellar(asLegacy(rows[0]), null, 'synthetic-ledger-secret');
    if (attack === 'unsigned_pending') rows[0].status = 'pending';
    if (attack === 'signed_delete') rows.pop();
    if (attack === 'all_delete') rows.splice(0);
    if (attack === 'old_id_insert') rows.push(row(0));
    const result = await s.verificar();
    assert.equal(result.legado?.conservado, false);
    assert.ok(result.rotos.some(r => r.motivo === 'limite_legacy_no_coincide'));
    assert.equal(result.desdeActivacion?.integra, false);
    rows.push(row(3));
    assert.equal(await s.firmar(3, null), null);
  }));
}

test('legacy manifest deletion/corruption/forgery is unverified, never automatically rebuilt', () => fixture(async (s, rows, path) => {
  await mixedLegacy(s, rows);
  const manifest = `${path}.legacy-boundary.json`;
  const original = await readFile(manifest, 'utf8');
  await writeFile(manifest, original.replace('confirmed', 'failed'));
  assert.equal((await s.verificar()).verificable, false);
  rows.push(row(3)); assert.equal(await s.firmar(3, null), null);
  await unlink(manifest);
  assert.equal((await s.verificar()).verificable, false);
  assert.equal(await s.firmar(3, null), null);
  await assert.rejects(readFile(manifest));
}));

test('legacy acceptance demands exact independently reviewed facts and refuses existing/orphan evidence', () => fixture(async (s, rows, path) => {
  rows.push(row(1));
  const expected = { total: 1, unsigned: 1, count: 0, tip: null, factsSha256: legacyFactsDigest(rows.map(asLegacy)) };
  const acceptance = 'ACEPTO LA FRONTERA LEGACY SIN AUTENTICIDAD RETROACTIVA';
  await assert.rejects(s.establecerFronteraLegacy(expected, 'yes'));
  await assert.rejects(s.establecerFronteraLegacy({ ...expected, factsSha256: 'a'.repeat(64) }, acceptance));
  rows[0].status = 'pending';
  await assert.rejects(s.establecerFronteraLegacy({ ...expected, factsSha256: legacyFactsDigest(rows.map(asLegacy)) }, acceptance));
  rows[0].status = 'confirmed';
  await s.establecerFronteraLegacy(expected, acceptance);
  await assert.rejects(s.establecerFronteraLegacy(expected, acceptance));
  await unlink(path);
  await assert.rejects(s.establecerFronteraLegacy(expected, acceptance), 'orphan manifest is evidence, never silently replaced');
  rows.splice(0);
  await assert.rejects(s.establecerBaseline(0, null, 'ACEPTO EL HISTORICO REVISADO'), 'v1 cannot bypass an orphan v2 manifest');
  assert.equal((await s.verificar()).verificable, false);
}));

test('future epoch tail deletion cannot be hidden by the accepted legacy exception', () => fixture(async (s, rows) => {
  await mixedLegacy(s, rows); rows.push(row(3)); assert.ok(await s.firmar(3, null));
  rows.pop(); const result = await s.verificar();
  assert.equal(result.legado?.conservado, true);
  assert.equal(result.desdeActivacion?.integra, false);
  assert.ok(result.rotos.some(r => r.motivo === 'checkpoint_no_coincide'));
}));

test('legacy CLI requires all reviewed counts, full digest, tip and its separate deliberate acceptance', () => {
  const args = ['--total=184', '--unsigned=156', '--count=28', `--tip=${'a'.repeat(64)}`, `--facts-sha256=${'b'.repeat(64)}`, '--accept-reviewed-legacy-boundary'];
  assert.deepEqual(parseLegacyBoundaryArgs(args), { total: 184, unsigned: 156, count: 28, tip: 'a'.repeat(64), factsSha256: 'b'.repeat(64) });
  for (const invalid of [args.slice(0, 5), [...args, '--extra=yes'], args.map(a => a === '--unsigned=156' ? '--unsigned=155' : a),
    args.map(a => a.startsWith('--tip=') ? '--tip=GENESIS' : a), args.map(a => a.startsWith('--facts-sha256=') ? '--facts-sha256=short' : a),
    args.map(a => a === '--accept-reviewed-legacy-boundary' ? '--accept-reviewed-history' : a),
    args.map(a => a === '--accept-reviewed-legacy-boundary' ? '--accept-reviewed-legacy-boundary=no' : a)]) assert.throws(() => parseLegacyBoundaryArgs(invalid));
});

test('v1 signing refuses earlier signed corruption even when anchored count and tip match', () => fixture(async (s, rows, path) => {
  await baseline(path); rows.push(row(1)); assert.ok(await s.firmar(1, null));
  rows.push(row(2)); assert.ok(await s.firmar(2, null));
  rows[0].target = 'tampered'; rows.push(row(3));
  assert.equal(await s.firmar(3, null), null);
  assert.equal(rows[2].signature, null);
}));

test('two concurrent live completions finalize and sign within the ledger turn, without an unsigned bypass', () => fixture(async (s, rows) => {
  await mixedLegacy(s, rows);
  rows.push({ ...row(3), status: 'pending' }, { ...row(4), status: 'pending' });
  const finalize = (id: number) => async () => { rows.find(r => r.id === id)!.status = 'confirmed'; };
  const signatures = await Promise.all([s.firmar(3, null, finalize(3)), s.firmar(4, null, finalize(4))]);
  assert.ok(signatures.every(Boolean));
  assert.equal(rows[2].status, 'confirmed'); assert.equal(rows[3].status, 'confirmed');
  assert.deepEqual((await s.verificar()).rotos, []);
  assert.equal((await s.verificar()).desdeActivacion?.firmadas, 2);
  rows.push(row(5), row(6));
  assert.equal(await s.firmar(6, null), null, 'unregistered completed unsigned row 5 remains a hard anomaly');
}));

test('failed checkpoint or host lock still preserves the executed command outcome exactly once', () => fixture(async (s, rows, path) => {
  rows.push({ ...row(1), status: 'pending' }); let completions = 0;
  const complete = async () => { completions++; rows[0].status = 'failed'; };
  assert.equal(await s.firmar(1, null, complete), null, 'missing checkpoint is fail closed');
  assert.equal(completions, 1); assert.equal(rows[0].status, 'failed'); assert.equal(rows[0].signature, null);
  rows.splice(0); await baseline(path); rows.push({ ...row(2), status: 'pending' });
  await writeFile(`${path}.lock`, 'held by another process');
  assert.equal(await s.firmar(2, null, complete), null);
  assert.equal(completions, 2); assert.equal(rows[0].status, 'failed'); assert.equal(rows[0].signature, null);
}));

test('an unfinished pending reservation cannot be signed if finalization does not persist', () => fixture(async (s, rows, path) => {
  await baseline(path); rows.push({ ...row(1), status: 'pending' });
  assert.equal(await s.firmar(1, null, async () => {}), null);
  assert.equal(rows[0].signature, null);
  assert.deepEqual((await s.verificar()).rotos, [], 'pending is still operational work in progress');
}));
