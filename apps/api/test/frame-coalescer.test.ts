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

/**
 * EL test que faltaba. Los adaptadores REUTILIZAN la misma instancia y hacen stop()+start() en
 * cada reconexión; sin revivirla, `add()` quedaba mudo para siempre y el puente entregaba cero
 * frames al dominio mientras se reportaba `Connected`. Costó 41 h de datos congelados en
 * producción (2026-08-13) con todos los indicadores en verde.
 */
test('coalescer: start() tras stop() vuelve a emitir (el ciclo de reconexión)', async () => {
  const frames: RawPlantFrame[] = [];
  const coalescer = new FrameCoalescer(10, (f) => frames.push(f));

  coalescer.stop();
  coalescer.add('montebello', sample('A'));
  assert.equal(frames.length, 0, 'parado sigue siendo no-op');

  coalescer.start();
  coalescer.add('montebello', sample('A'));
  await delay(30);
  assert.equal(frames.length, 1, 'tras start() los datos DEBEN volver a fluir');
  assert.equal(frames[0].plantId, 'montebello');
});

test('coalescer: start() es idempotente y no duplica frames', async () => {
  const frames: RawPlantFrame[] = [];
  const coalescer = new FrameCoalescer(10, (f) => frames.push(f));
  coalescer.start();
  coalescer.start();
  coalescer.add('montebello', sample('A'));
  await delay(30);
  assert.equal(frames.length, 1);
});
