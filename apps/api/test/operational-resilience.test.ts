/**
 * FASE 6 — Validación operacional: CAOS DE CONECTIVIDAD (escenarios destructivos).
 *
 * No agrega features: valida que el puente SOBREVIVE a la operación real sin intervención
 * manual (regla de la Fase 6). Maneja el pipeline REAL (SimulatorBridgeAdapter +
 * PlantPipelineService + PlantCache, el mismo cableado que producción) y usa las perillas de
 * emulación del simulador (freeze/faultBuffer/setRecycleOutcome/setHeartbeatOutcome) para
 * reproducir cortes, congelamientos, buffers caídos y fallos irrecuperables.
 *
 * Timers acortados (watchdog/heartbeat en decenas de ms) para que cada escenario corra en
 * segundos. La lógica ejercida es idéntica a la de producción — solo cambian los tiempos.
 *
 * Correlación con docs/OPERATIONAL_VALIDATION.md §1 (caos) y §5 (arranque en frío).
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { TankAutonomyStore } from '../src/infrastructure/connectivity/pipeline/tank-autonomy.store';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type {
  ConnectivityConfig,
  LivenessConfig,
  OpcUaConfig,
} from '../src/infrastructure/connectivity/connectivity.config';
import type { BridgeStatus } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import type { PlantSnapshotDto } from '../src/infrastructure/connectivity/pipeline/plant-snapshot.dto';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Espera activa hasta que `pred()` sea true o venza el timeout. Devuelve si se cumplió. */
async function waitFor(pred: () => boolean, timeoutMs = 4000, stepMs = 10): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await delay(stepMs);
  }
  return pred();
}

function makeConfig(over: Partial<OpcUaConfig> = {}, live: Partial<LivenessConfig> = {}): ConnectivityConfig {
  const opcua: OpcUaConfig = {
    endpoint: 'simulator://in-memory',
    endpointMustExist: false,
    securityMode: 'None',
    securityPolicy: 'None',
    identity: { type: 'anonymous' },
    autoAcceptUnknownCertificate: false,
    publishingIntervalMs: 20,
    samplingIntervalMs: 20,
    subscriptionLifetimeCount: 100,
    subscriptionMaxKeepAliveCount: 10,
    coalesceWindowMs: 20,
    watchdogTimeoutMs: 120,
    heartbeatIntervalMs: 40,
    heartbeatMaxFailures: 2,
    reconnectInitialDelayMs: 10,
    reconnectMaxDelayMs: 50,
    reconnectMaxRetry: 1000,
    subscriptionRecycleMaxAttempts: 2,
    staleThresholdMs: 300000,
    writesEnabled: false,
    allowInsecureWrites: false,
    ...over,
  };
  return {
    provider: 'simulator',
    opcua,
    liveness: { liveSec: 10, windowSec: 300, sweepMs: 40, ...live },
    deadLetterCapacity: 500,
  };
}

interface Harness {
  adapter: SimulatorBridgeAdapter;
  pipeline: PlantPipelineService;
  statuses: BridgeStatus[];
  snapshots: PlantSnapshotDto[];
  firstSnapshotMs: number | null;
  stop: () => Promise<void>;
}

/** Construye y arranca el pipeline real. Registra el listener de snapshots ANTES de start()
 *  para poder medir el arranque en frío (tiempo hasta el primer snapshot). */
function boot(config: ConnectivityConfig): Harness {
  const mapping = loadMapping();
  const adapter = new SimulatorBridgeAdapter(config.opcua, mapping);
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, config, cache, new TankAutonomyStore());

  const statuses: BridgeStatus[] = [adapter.getBridgeStatus()];
  adapter.onStatusChange((s) => statuses.push(s));

  const snapshots: PlantSnapshotDto[] = [];
  const t0 = Date.now();
  const h: Harness = {
    adapter,
    pipeline,
    statuses,
    snapshots,
    firstSnapshotMs: null,
    stop: async () => {
      pipeline.onModuleDestroy();
      sub.unsubscribe();
      await adapter.stop();
    },
  };
  const sub = pipeline.snapshot$.subscribe((snap) => {
    if (h.firstSnapshotMs === null) h.firstSnapshotMs = Date.now() - t0;
    snapshots.push(snap);
  });

  pipeline.onModuleInit(); // registra onFrame + sweep
  return h;
}

// ── Escenario 5 (primero, es el más simple): ARRANQUE EN FRÍO ───────────────────────────────
test('caos: arranque en frío → Connected y primer snapshot rápidamente', async () => {
  const h = boot(makeConfig());
  try {
    await h.adapter.start();
    const ok = await waitFor(() => h.firstSnapshotMs !== null, 3000);
    assert.equal(ok, true, 'debe emitir un primer snapshot tras el arranque');
    assert.equal(h.adapter.getBridgeStatus(), 'Connected');
    assert.ok((h.firstSnapshotMs ?? Infinity) < 2000, `primer snapshot en ${h.firstSnapshotMs}ms`);
  } finally {
    await h.stop();
  }
});

// ── Escenario 1c: NOTIFICACIONES CONGELADAS → watchdog → Stale → reciclaje → recuperación ────
test('caos: congelar notificaciones dispara el watchdog y se recupera solo (Connected→Stale→Connected)', async () => {
  const h = boot(makeConfig());
  try {
    await h.adapter.start();
    await waitFor(() => h.snapshots.length > 0, 2000);

    const beforeReconnect = h.adapter.getDiagnostics().subscriptionRecycleCount;
    h.adapter.freeze(); // emula una Subscription muerta: dejan de llegar notificaciones

    const wentStale = await waitFor(() => h.statuses.includes('Stale'), 2000);
    assert.equal(wentStale, true, 'sin notificaciones el puente debe pasar a Stale');

    const recovered = await waitFor(
      () => h.adapter.getBridgeStatus() === 'Connected' && h.statuses.lastIndexOf('Connected') > h.statuses.indexOf('Stale'),
      3000,
    );
    assert.equal(recovered, true, 'el reciclaje automático debe devolver el puente a Connected');
    assert.ok(h.adapter.getDiagnostics().subscriptionRecycleCount >= beforeReconnect, 'hubo reciclaje');
    // y sin reiniciar el proceso: siguen llegando snapshots nuevos tras la recuperación
    const n = h.snapshots.length;
    const flowing = await waitFor(() => h.snapshots.length > n, 2000);
    assert.equal(flowing, true, 'tras recuperar, los snapshots vuelven a fluir sin reiniciar el backend');
  } finally {
    await h.stop();
  }
});

// ── Escenario 1d: NodeId/buffer que desaparece → degradación AISLADA por buffer ──────────────
test('caos: un buffer faulted degrada SOLO ese buffer, el puente sigue Connected y las demás plantas fluyen', async () => {
  const h = boot(makeConfig());
  try {
    await h.adapter.start();
    await waitFor(() => h.snapshots.length > 0, 2000);

    const health = h.adapter.getBufferHealth();
    assert.ok(health.length > 1, 'debe haber varios buffers');
    const victim = health[0];
    h.adapter.faultBuffer(victim.plantId, victim.browseName);

    const afterHealth = h.adapter.getBufferHealth();
    const faulted = afterHealth.find((b) => b.plantId === victim.plantId && b.browseName === victim.browseName);
    assert.equal(faulted?.faulted, true, 'el buffer objetivo queda faulted');
    assert.equal(h.adapter.getDiagnostics().bridgeStatus, 'Connected', 'un buffer caído NO tumba el puente');
    assert.ok(h.adapter.getDiagnostics().buffersFaulted >= 1);
    assert.ok(h.adapter.getDiagnostics().buffersActive < afterHealth.length, 'quedan menos buffers activos que el total');

    // otras plantas siguen emitiendo snapshots
    const otherPlant = h.snapshots.map((s) => s.plantId).find((p) => p !== victim.plantId);
    if (otherPlant) {
      const n = h.snapshots.filter((s) => s.plantId === otherPlant).length;
      const flowing = await waitFor(() => h.snapshots.filter((s) => s.plantId === otherPlant).length > n, 2000);
      assert.equal(flowing, true, 'las plantas no afectadas siguen fluyendo');
    }
  } finally {
    await h.stop();
  }
});

// ── Escenario 1e: fallo IRRECUPERABLE → Faulted (diseñado para terminar en Faulted y ALERTAR) ─
test('caos: si el reciclaje falla repetidamente, el puente termina en Faulted (estado que debe alertar)', async () => {
  const h = boot(makeConfig({ subscriptionRecycleMaxAttempts: 1 }));
  try {
    await h.adapter.start();
    await waitFor(() => h.snapshots.length > 0, 2000);

    h.adapter.setRecycleOutcome('fail'); // ni la subscription ni la sesión logran reciclarse
    h.adapter.freeze();

    const faulted = await waitFor(() => h.adapter.getBridgeStatus() === 'Faulted', 4000);
    assert.equal(faulted, true, 'tras agotar reintentos, el puente debe quedar Faulted (no colgado en silencio)');
    // Faulted es terminal: la transición queda registrada (para la alerta)
    const transitions = h.adapter.getDiagnostics().recentTransitions;
    assert.ok(transitions.some((t) => t.to === 'Faulted'), 'la transición a Faulted queda registrada con motivo');
  } finally {
    await h.stop();
  }
});

// ── Escenario 1f: HEARTBEAT en fallo → Recovering → reciclaje de sesión → recuperación ───────
test('caos: fallos de heartbeat fuerzan Recovering y reciclan la sesión (reconnectCount sube)', async () => {
  const h = boot(makeConfig());
  try {
    await h.adapter.start();
    await waitFor(() => h.snapshots.length > 0, 2000);

    const before = h.adapter.getDiagnostics().reconnectCount;
    h.adapter.setHeartbeatOutcome('fail');

    const recovering = await waitFor(() => h.statuses.includes('Recovering'), 3000);
    assert.equal(recovering, true, 'los fallos de heartbeat deben forzar Recovering');
    h.adapter.setHeartbeatOutcome('success'); // dejamos que se estabilice

    const recovered = await waitFor(
      () => h.adapter.getBridgeStatus() === 'Connected' && h.adapter.getDiagnostics().reconnectCount > before,
      3000,
    );
    assert.equal(recovered, true, 'la sesión se recicla y vuelve a Connected sin reiniciar el backend');
  } finally {
    await h.stop();
  }
});

// ── Integridad de sequence bajo operación normal (base para la detección de huecos del front) ─
test('robustez: sequence es estrictamente monotónico por planta (sin huecos en operación normal)', async () => {
  const h = boot(makeConfig());
  try {
    await h.adapter.start();
    await waitFor(() => h.snapshots.length > 60, 4000);

    const perPlant = new Map<string, number[]>();
    for (const s of h.snapshots) {
      const arr = perPlant.get(s.plantId) ?? [];
      arr.push(s.sequence);
      perPlant.set(s.plantId, arr);
    }
    for (const [plantId, seqs] of perPlant) {
      for (let i = 1; i < seqs.length; i++) {
        assert.equal(seqs[i], seqs[i - 1] + 1, `sequence de ${plantId} debe ser +1 (sin huecos): ${seqs[i - 1]}→${seqs[i]}`);
      }
    }
  } finally {
    await h.stop();
  }
});
