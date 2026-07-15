/**
 * Tests del HeartbeatMonitor (FASE 1.1 / A3). Deterministas: sin timers, vía runOnce().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeartbeatMonitor } from '../src/infrastructure/connectivity/bridge/heartbeat-monitor';

function makeMonitor(probeResult: () => Promise<void>, maxFailures = 2) {
  const thresholds: string[] = [];
  const monitor = new HeartbeatMonitor({
    intervalMs: 10_000, // irrelevante: usamos runOnce() a mano
    maxFailures,
    probe: probeResult,
    onFailureThreshold: (reason) => thresholds.push(reason),
  });
  return { monitor, thresholds };
}

const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error('probe caído'));

test('heartbeat: N fallos consecutivos disparan el threshold exactamente una vez', async () => {
  const { monitor, thresholds } = makeMonitor(fail, 2);
  await monitor.runOnce(); // 1er fallo
  assert.equal(thresholds.length, 0);
  await monitor.runOnce(); // 2º fallo → threshold
  assert.equal(thresholds.length, 1);
  assert.match(thresholds[0], /2 fallos consecutivos/);
});

test('heartbeat: un probe OK resetea el contador consecutivo', async () => {
  let mode: 'fail' | 'ok' = 'fail';
  const { monitor, thresholds } = makeMonitor(() => (mode === 'fail' ? fail() : ok()), 2);
  await monitor.runOnce(); // fallo 1
  mode = 'ok';
  await monitor.runOnce(); // OK → resetea consecutivos
  mode = 'fail';
  await monitor.runOnce(); // fallo 1 de nuevo (no dispara)
  assert.equal(thresholds.length, 0);
  assert.equal(monitor.getStats().heartbeatFailures, 1);
  assert.equal(monitor.getStats().heartbeatFailuresTotal, 2);
});

test('heartbeat: tras disparar, exige N fallos NUEVOS para re-disparar', async () => {
  const { monitor, thresholds } = makeMonitor(fail, 2);
  await monitor.runOnce();
  await monitor.runOnce(); // threshold #1
  assert.equal(thresholds.length, 1);
  await monitor.runOnce(); // consecutivos = 1 (se reseteó al disparar)
  assert.equal(thresholds.length, 1);
  await monitor.runOnce(); // consecutivos = 2 → threshold #2
  assert.equal(thresholds.length, 2);
});

test('heartbeat: getStats registra timestamps de último probe y último exitoso', async () => {
  let mode: 'fail' | 'ok' = 'ok';
  const { monitor } = makeMonitor(() => (mode === 'ok' ? ok() : fail()), 2);
  await monitor.runOnce();
  const afterOk = monitor.getStats();
  assert.ok(afterOk.lastHeartbeatAt);
  assert.ok(afterOk.lastSuccessfulHeartbeatAt);
  assert.equal(afterOk.lastHeartbeatAt, afterOk.lastSuccessfulHeartbeatAt);

  mode = 'fail';
  await monitor.runOnce();
  const afterFail = monitor.getStats();
  // El último exitoso queda CONGELADO en el valor del OK previo; el probe fallido no lo toca.
  assert.equal(afterFail.lastSuccessfulHeartbeatAt, afterOk.lastSuccessfulHeartbeatAt);
  assert.equal(afterFail.heartbeatFailures, 1);
  assert.equal(afterFail.heartbeatFailuresTotal, 1);
});
