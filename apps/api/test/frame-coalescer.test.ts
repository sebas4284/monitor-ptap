/**
 * Tests del FrameCoalescer (FASE 1.1 / A2). Un frame por planta por ventana.
 * Ejecutar: npm run test:bridge (o el script test agregado).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameCoalescer } from '../src/infrastructure/connectivity/bridge/frame-coalescer';
import type { RawBufferSample, RawPlantFrame } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sample(browseName: string): RawBufferSample {
  return {
    browseName,
    channel: 'realIn',
    values: [1, 2, 3],
    quality: 'Good',
    statusCode: 'Good',
    sourceTimestamp: new Date().toISOString(),
    serverTimestamp: new Date().toISOString(),
  };
}

test('coalescer: 7 buffers de una planta → 1 frame con 7 buffers', async () => {
  const frames: RawPlantFrame[] = [];
  const coalescer = new FrameCoalescer(20, (f) => frames.push(f));
  for (let i = 0; i < 7; i++) coalescer.add('montebello', sample(`BUF_${i}`));
  await delay(50);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].plantId, 'montebello');
  assert.equal(frames[0].buffers.length, 7);
  assert.equal(new Set(frames[0].buffers.map((b) => b.browseName)).size, 7);
  coalescer.stop();
});

test('coalescer: no bloquea esperando buffers ausentes (2 de 7 → frame con 2)', async () => {
  const frames: RawPlantFrame[] = [];
  const coalescer = new FrameCoalescer(20, (f) => frames.push(f));
  coalescer.add('montebello', sample('BUF_0'));
  coalescer.add('montebello', sample('BUF_1'));
  await delay(50);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].buffers.length, 2);
  coalescer.stop();
});

test('coalescer: mismo browseName dos veces → last-wins (1 entrada)', async () => {
  const frames: RawPlantFrame[] = [];
  const coalescer = new FrameCoalescer(20, (f) => frames.push(f));
  const first = sample('BUF_0');
  const second = { ...sample('BUF_0'), values: [9, 9, 9] };
  coalescer.add('montebello', first);
  coalescer.add('montebello', second);
  await delay(50);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].buffers.length, 1);
  assert.deepEqual(frames[0].buffers[0].values, [9, 9, 9]);
  coalescer.stop();
});

test('coalescer: dos plantas → dos frames independientes', async () => {
  const frames: RawPlantFrame[] = [];
  const coalescer = new FrameCoalescer(20, (f) => frames.push(f));
  coalescer.add('montebello', sample('A'));
  coalescer.add('voragine', sample('B'));
  await delay(50);
  assert.equal(frames.length, 2);
  assert.deepEqual(new Set(frames.map((f) => f.plantId)), new Set(['montebello', 'voragine']));
  coalescer.stop();
});

test('coalescer: stop() flushea lo pendiente (nada se pierde, regla 12)', () => {
  const frames: RawPlantFrame[] = [];
  const coalescer = new FrameCoalescer(10_000, (f) => frames.push(f)); // ventana larga: no vencería sola
  coalescer.add('montebello', sample('A'));
  coalescer.stop(); // debe flushear sin esperar la ventana
  assert.equal(frames.length, 1);
  assert.equal(frames[0].buffers.length, 1);
});

test('coalescer: add() tras stop() es no-op', () => {
  const frames: RawPlantFrame[] = [];
  const coalescer = new FrameCoalescer(10, (f) => frames.push(f));
  coalescer.stop();
  coalescer.add('montebello', sample('A'));
  assert.equal(frames.length, 0);
});
