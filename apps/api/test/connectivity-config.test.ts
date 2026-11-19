/**
 * Tests de loadConnectivityConfig (FASE 1.1 / limpieza). Validación de arranque:
 * lifetime >= 3 × keepAlive, y defaults derivados. Node built-in runner vía tsx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConnectivityConfig } from '../src/infrastructure/connectivity/connectivity.config';

/** Ejecuta fn con un entorno OPC UA temporal y restaura process.env al terminar. */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const keys = Object.keys(overrides);
  const saved = new Map<string, string | undefined>();
  for (const k of keys) saved.set(k, process.env[k]);
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of keys) {
      const v = saved.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('config: lifetime < 3 × keepAlive → loadConnectivityConfig lanza (backend no arranca)', () => {
  withEnv(
    {
      CONNECTIVITY_PROVIDER: 'opcua',
      OPCUA_REQUESTED_LIFETIME_COUNT: '20',
      OPCUA_REQUESTED_MAX_KEEPALIVE_COUNT: '10', // 20 < 30 → inválido
    },
    () => {
      assert.throws(() => loadConnectivityConfig(), /debe ser >= 3/);
    },
  );
});

test('config: lifetime >= 3 × keepAlive → carga sin lanzar', () => {
  withEnv(
    {
      CONNECTIVITY_PROVIDER: 'opcua',
      OPCUA_REQUESTED_LIFETIME_COUNT: '30',
      OPCUA_REQUESTED_MAX_KEEPALIVE_COUNT: '10',
    },
    () => {
      const cfg = loadConnectivityConfig();
      assert.equal(cfg.opcua.subscriptionLifetimeCount, 30);
      assert.equal(cfg.opcua.subscriptionMaxKeepAliveCount, 10);
    },
  );
});

test('config: keepAlive < 1 → lanza (evita que 3×0 valide cualquier lifetime)', () => {
  withEnv(
    {
      CONNECTIVITY_PROVIDER: 'opcua',
      OPCUA_REQUESTED_MAX_KEEPALIVE_COUNT: '0',
      OPCUA_REQUESTED_LIFETIME_COUNT: '100',
    },
    () => {
      assert.throws(() => loadConnectivityConfig(), /KEEPALIVE_COUNT/);
    },
  );
});

test('config: coalesceWindowMs por defecto = publishingIntervalMs', () => {
  withEnv(
    {
      CONNECTIVITY_PROVIDER: 'opcua',
      OPCUA_PUBLISHING_INTERVAL_MS: '1500',
      OPCUA_COALESCE_WINDOW_MS: undefined, // sin override → toma el default
      OPCUA_REQUESTED_LIFETIME_COUNT: undefined,
      OPCUA_REQUESTED_MAX_KEEPALIVE_COUNT: undefined,
    },
    () => {
      const cfg = loadConnectivityConfig();
      assert.equal(cfg.opcua.coalesceWindowMs, 1500);
    },
  );
});

test('config: heartbeatMaxFailures default = 2', () => {
  withEnv({ CONNECTIVITY_PROVIDER: 'opcua', OPCUA_HEARTBEAT_MAX_FAILURES: undefined }, () => {
    const cfg = loadConnectivityConfig();
    assert.equal(cfg.opcua.heartbeatMaxFailures, 2);
  });
});

test('config: deadLetterCapacity sale de OPC_DEAD_LETTER_CAPACITY (regla 8/12: el tope por env, no quemado)', () => {
  withEnv({ CONNECTIVITY_PROVIDER: 'simulator', OPC_DEAD_LETTER_CAPACITY: '25' }, () => {
    assert.equal(loadConnectivityConfig().deadLetterCapacity, 25);
  });
});

test('config: sin OPC_DEAD_LETTER_CAPACITY → default 500', () => {
  withEnv({ CONNECTIVITY_PROVIDER: 'simulator', OPC_DEAD_LETTER_CAPACITY: undefined }, () => {
    assert.equal(loadConnectivityConfig().deadLetterCapacity, 500);
  });
});

test('config: OPC_DEAD_LETTER_CAPACITY=0 → lanza (un ring de tope 0 se tragaría el detalle sin rastro)', () => {
  withEnv({ CONNECTIVITY_PROVIDER: 'simulator', OPC_DEAD_LETTER_CAPACITY: '0' }, () => {
    assert.throws(() => loadConnectivityConfig(), /OPC_DEAD_LETTER_CAPACITY/);
  });
});
