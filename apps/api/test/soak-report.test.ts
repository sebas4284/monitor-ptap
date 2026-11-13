import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function report(hours: number, objective: number, closed = true, interrupted = false) {
  const directory = mkdtempSync(join(tmpdir(), 'ptap soak report '));
  try {
    const start = Date.parse('2026-11-11T08:00:00Z');
    const rows: unknown[] = [{ tipo: 'inicio', t: new Date(start).toISOString(), soakHours: objective }];
    for (let i = 0; i <= 8; i += 1) {
      rows.push({
        tipo: 'muestra', t: new Date(start + hours * 3600_000 * i / 8).toISOString(),
        minuto: hours * 60 * i / 8, rssMB: 100, heapMB: 40, externalMB: 1,
        handles: 2, requests: 0, snapshots: i * 100, deadLetter: 0, reconnects: 0,
        bridge: 'Connected',
      });
    }
    if (closed) rows.push({
      tipo: 'veredicto', horas: hours, muestras: 9, rssMin: 100, rssMax: 100,
      variacionPct: 0, crecimientoPct: 0, handlesInicio: 2, handlesFin: 2,
      deadLetterFinal: 0, snapshots: 800, ciclosDeCaos: 0,
      okRss: true, okHandles: true, cortadoAntes: interrupted,
    });
    const file = join(directory, 'soak.jsonl');
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/soak-report.ts', file, '--markdown'], {
      cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 10_000, env,
    });
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('soak report rejects 24 hours when the requested duration is 72 hours', () => {
  const result = report(24, 72);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /objetivo incompleto \(mínimo 72 h\)/);
});

test('soak report accepts a clean 72 hour run and reports the same criterion in Markdown', () => {
  const result = report(72, 72);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CUMPLE los criterios/);
  assert.match(result.stdout, /Duración \| 72 h \| ✅ ≥ 72 h/);
});

test('soak report preserves acceptance of a complete historical 24 hour run', () => {
  const result = report(24, 24);
  assert.equal(result.status, 0, result.stderr);
});

test('soak report rejects a truncated JSONL even with sufficient elapsed time', () => {
  const result = report(72, 72, false);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /RECALCULADO/);
  assert.match(result.stdout, /Cierre completo \| No/);
});

test('soak report rejects an interrupted run even when it has a verdict', () => {
  const result = report(72, 72, true, true);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /no acredita un cierre completo/);
});

test('soak report does not relax the 24 hour minimum for a short requested rehearsal', () => {
  const result = report(1, 1);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /mínimo 24 h/);
});
