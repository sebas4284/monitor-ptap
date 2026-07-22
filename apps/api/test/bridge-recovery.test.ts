/**
 * DEF-01 — recuperación automática de `Faulted`. La garantía: si el puente cae a `Faulted`
 * DESPUÉS de haber estado operativo (p. ej. un reciclaje de sesión que falla por un transitorio),
 * el orquestador lo relanza con `stop()`+`start()` en vez de dejarlo terminal hasta reiniciar el
 * proceso a mano. Y que un `Faulted` DE ARRANQUE no dispare una recuperación extra (lo maneja el
 * reintento con backoff del propio `startWithRetry`).
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeOrchestratorService } from '../src/infrastructure/connectivity/bridge-orchestrator.service';
import type { ConnectivityAdapter, BridgeStatus } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import type { ConnectivityConfig } from '../src/infrastructure/connectivity/connectivity.config';

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const config = { opcua: { reconnectMaxDelayMs: 10_000 } } as unknown as ConnectivityConfig;

/** Adaptador doble: captura el listener de estado y cuenta start()/stop(). `startImpl` permite
 *  simular un arranque que emite Faulted y lanza (caso de arranque). */
function fakeAdapter(startImpl?: (emit: (s: BridgeStatus) => void) => Promise<void>) {
  let listener: ((s: BridgeStatus, reason: string) => void) | null = null;
  const calls = { start: 0, stop: 0 };
  const emit = (s: BridgeStatus, reason = ''): void => listener?.(s, reason);
  const adapter = {
    provider: 'opcua',
    onStatusChange: (l: (s: BridgeStatus, reason: string) => void) => { listener = l; },
    start: async () => { calls.start++; if (startImpl) await startImpl(emit); },
    stop: async () => { calls.stop++; },
  } as unknown as ConnectivityAdapter;
  return { adapter, calls, emit };
}

test('DEF-01: un Faulted POST-arranque dispara stop()+start() (ya no es terminal)', async () => {
  const { adapter, calls, emit } = fakeAdapter();
  const svc = new BridgeOrchestratorService(adapter, config);
  svc.onModuleInit(); // start #1 (arranque)
  await tick();
  assert.equal(calls.start, 1);
  assert.equal(calls.stop, 0);

  emit('Faulted', 'reciclaje de sesión falló'); // post-arranque, sin ciclo en curso → recupera
  await tick();
  await tick();
  assert.equal(calls.stop, 1, 'debe liberar cliente/sesión con stop()');
  assert.equal(calls.start, 2, 'debe relanzar el puente');

  await svc.onModuleDestroy();
});

test('DEF-01: un Faulted DURANTE el arranque NO recupera de más (lo maneja el reintento)', async () => {
  // start() emite Faulted y lanza: es el camino de arranque, que startWithRetry ya reintenta.
  const { adapter, calls } = fakeAdapter(async (emit) => {
    emit('Faulted', 'namespace no resuelto');
    throw new Error('namespace no resuelto');
  });
  const svc = new BridgeOrchestratorService(adapter, config);
  svc.onModuleInit();
  await tick();
  await tick();
  assert.equal(calls.stop, 0, 'el Faulted de arranque NO debe disparar stop() (evita doble recuperación)');
  assert.equal(calls.start, 1, 'solo el arranque; el reintento queda programado con backoff');

  await svc.onModuleDestroy();
});
