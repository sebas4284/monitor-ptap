/**
 * La corrección del mapeo se aplica EN CALIENTE: contra el pipeline vivo, sin reiniciar el proceso.
 *
 * Es el criterio de la fase C.3 y el único que no se puede comprobar con funciones puras, porque lo
 * que falla aquí no es el cálculo: es el camino. Se monta el mismo cableado de producción
 * (SimulatorBridgeAdapter → PlantPipelineService → PlantCache) y se mira el DTO que acaba en la
 * cache, que es lo que de verdad ve la app.
 *
 * El primer test es una regresión con nombre propio. La firma del diff omite a propósito los campos
 * estáticos del mapping —unit, label, opMin, opMax, confidence— porque «no cambian sin reiniciar», y
 * eso deja de ser cierto en el momento en que existe esta función: corregir SOLO la unidad daba la
 * misma firma, el snapshot se descartaba por idéntico al anterior, y la corrección quedaba guardada
 * y aplicada pero invisible en el tablero hasta que algún valor cambiara por su cuenta. El fallo más
 * caro posible de esta función: la persona corrige, la app dice que sí, y no se ve nada.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { TankAutonomyStore } from '../src/infrastructure/connectivity/pipeline/tank-autonomy.store';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import { bufferDeLaSenal } from '../src/infrastructure/connectivity/mapping/mapping-overrides';
import type { ConnectivityConfig, OpcUaConfig } from '../src/infrastructure/connectivity/connectivity.config';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 5000, stepMs = 10): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await delay(stepMs);
  }
  return pred();
}

function makeConfig(): ConnectivityConfig {
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
    watchdogTimeoutMs: 5000,
    heartbeatIntervalMs: 1000,
    heartbeatMaxFailures: 2,
    reconnectInitialDelayMs: 10,
    reconnectMaxDelayMs: 50,
    reconnectMaxRetry: 1000,
    subscriptionRecycleMaxAttempts: 2,
    staleThresholdMs: 300000,
    writesEnabled: false,
    allowInsecureWrites: false,
  };
  return {
    provider: 'simulator',
    opcua,
    liveness: { liveSec: 10, windowSec: 300, sweepMs: 1000 },
    deadLetterCapacity: 500,
  };
}

/**
 * La primera señal editable que está recibiendo datos de verdad, con su buffer resuelto.
 * `null` mientras el simulador no haya entregado nada todavía.
 */
function elegir(
  pipeline: PlantPipelineService,
  mapping: ReturnType<typeof loadMapping>,
  cache: PlantCache,
) {
  for (const s of mapping.signals) {
    if (s.writable || s.mappingStatus !== 'mapped') continue;
    if (!cache.get(s.plantId)) continue;
    const buffer = bufferDeLaSenal(mapping, s.plantId, s.buffer, s.sourceBuffer);
    if (!buffer) continue;
    const muestra = pipeline.getLatestBuffers(s.plantId)?.get(buffer.browseName);
    if (!muestra || muestra.values.length < 2) continue;
    if (!cache.get(s.plantId)?.signals[s.domainKey]) continue;
    return { plantId: s.plantId, domainKey: s.domainKey };
  }
  return null;
}

/** Pipeline real alimentado por el simulador, con la cache ya poblada. */
async function pipelineVivo() {
  const config = makeConfig();
  const mapping = loadMapping();
  const adapter = new SimulatorBridgeAdapter(config.opcua, mapping);
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, config, cache, new TankAutonomyStore());
  pipeline.onModuleInit();
  await adapter.start();

  // La señal se BUSCA, no se fija: un test anclado a `cascajal.outletFlow1` se rompería el día que
  // alguien la renombre sin que nada esté mal de verdad. Y tiene que cumplir tres cosas para que el
  // test mida algo: de solo lectura, mapeada, y con un buffer que de VERDAD esté entregando al menos
  // dos elementos — el canal intOut, por ejemplo, es donde escribimos nosotros y el simulador no lo
  // publica, así que una señal de ahí dejaría el test comprobando el vacío.
  const elegida = await waitFor(() => Boolean(elegir(pipeline, mapping, cache)));
  assert.equal(elegida, true, 'el pipeline debe haber poblado la cache con datos antes de medir');
  const candidata = elegir(pipeline, mapping, cache);
  assert.ok(candidata);
  const plantId = candidata.plantId;

  return {
    pipeline,
    cache,
    adapter,
    mapping,
    plantId,
    domainKey: candidata.domainKey,
    cerrar: async () => {
      pipeline.onModuleDestroy();
      await adapter.stop();
    },
  };
}

test('caliente: corregir SOLO la unidad ya se ve en el DTO (regresión del diff)', async () => {
  const v = await pipelineVivo();
  try {
    const antes = v.cache.get(v.plantId)?.signals[v.domainKey];
    assert.ok(antes, `${v.domainKey} debe estar en el snapshot`);
    const unidadOriginal = antes.unit;

    v.pipeline.setOverrides([
      { plantId: v.plantId, domainKey: v.domainKey, patch: { unit: 'ZZ' }, by: 'test', at: null },
    ]);

    const despues = v.cache.get(v.plantId)?.signals[v.domainKey];
    assert.equal(
      despues?.unit,
      'ZZ',
      'la unidad nueva tiene que estar en la cache YA: si el diff suprime el snapshot, la corrección queda invisible',
    );
    assert.notEqual(unidadOriginal, 'ZZ', 'el fixture no sirve si la unidad ya era ZZ');
  } finally {
    await v.cerrar();
  }
});

test('caliente: la señal corregida sale como inferred', async () => {
  // No es cosmético: dice que detrás de ese índice hay una decisión de una persona y no un
  // documento de la planta. Si no viajara en el DTO, el tablero seguiría afirmando `confirmed`.
  const v = await pipelineVivo();
  try {
    v.pipeline.setOverrides([
      { plantId: v.plantId, domainKey: v.domainKey, patch: { unit: 'ZZ' }, by: 'test', at: null },
    ]);
    assert.equal(v.cache.get(v.plantId)?.signals[v.domainKey]?.confidence, 'inferred');
  } finally {
    await v.cerrar();
  }
});

test('caliente: mover el ÍNDICE hace que el DTO lea el otro elemento del buffer', async () => {
  const v = await pipelineVivo();
  try {
    const senal = v.mapping.signals.find((s) => s.plantId === v.plantId && s.domainKey === v.domainKey);
    assert.ok(senal);
    const buffer = bufferDeLaSenal(v.mapping, v.plantId, senal.buffer, senal.sourceBuffer);
    assert.ok(buffer, 'la señal debe resolver a un buffer del mapeo');

    // El valor esperado se saca de la MUESTRA CRUDA que ya tiene el pipeline, no de un número
    // inventado: así el test no depende de lo que el simulador decida generar.
    const muestra = v.pipeline.getLatestBuffers(v.plantId)?.get(buffer.browseName);
    assert.ok(muestra, `no llegó muestra de ${buffer.browseName}`);
    const destino = senal.index === 0 ? 1 : 0;
    assert.ok(muestra.values.length > destino, 'el buffer tiene que traer al menos dos elementos');
    const esperado = muestra.values[destino];

    v.pipeline.setOverrides([
      { plantId: v.plantId, domainKey: v.domainKey, patch: { index: destino }, by: 'test', at: null },
    ]);

    const dto = v.cache.get(v.plantId)?.signals[v.domainKey];
    assert.equal(
      dto?.value,
      esperado,
      'tras mover el índice, el DTO tiene que traer el valor de la posición NUEVA',
    );
  } finally {
    await v.cerrar();
  }
});

test('caliente: quitar las correcciones vuelve al mapeo del repositorio', async () => {
  // Es lo que hace que revertir sea de verdad reversible: el efectivo se recalcula desde el base,
  // no se van apilando parches encima del anterior.
  const v = await pipelineVivo();
  try {
    const original = v.cache.get(v.plantId)?.signals[v.domainKey]?.unit;

    v.pipeline.setOverrides([
      { plantId: v.plantId, domainKey: v.domainKey, patch: { unit: 'ZZ' }, by: 'test', at: null },
    ]);
    assert.equal(v.cache.get(v.plantId)?.signals[v.domainKey]?.unit, 'ZZ');

    v.pipeline.setOverrides([]);
    const dto = v.cache.get(v.plantId)?.signals[v.domainKey];
    assert.equal(dto?.unit, original ?? null, 'la unidad vuelve a la del JSON');
    assert.equal(dto?.confidence !== 'inferred' || original === null, true, 'y la confianza también');
  } finally {
    await v.cerrar();
  }
});

test('caliente: una corrección sobre UNA planta no toca las demás', async () => {
  const v = await pipelineVivo();
  try {
    const otra = v.mapping.plants.find((p) => p.plantId !== v.plantId);
    assert.ok(otra, 'el mapeo real tiene más de una planta');
    await waitFor(() => v.cache.get(otra.plantId) !== undefined);
    const antes = JSON.stringify(v.cache.get(otra.plantId)?.signals ?? {});

    v.pipeline.setOverrides([
      { plantId: v.plantId, domainKey: v.domainKey, patch: { unit: 'ZZ' }, by: 'test', at: null },
    ]);

    // Se comparan los campos del mapping, no el snapshot entero: los valores siguen llegando del
    // simulador y cambian por su cuenta entre una lectura y otra.
    const despues = v.cache.get(otra.plantId)?.signals ?? {};
    for (const [clave, sig] of Object.entries(despues)) {
      const previo = (JSON.parse(antes) as Record<string, { unit: string | null; confidence: string }>)[clave];
      if (!previo) continue;
      assert.equal(sig.unit, previo.unit, `${otra.plantId}.${clave} no debía cambiar de unidad`);
      assert.equal(sig.confidence, previo.confidence, `${otra.plantId}.${clave} no debía cambiar de confianza`);
    }
  } finally {
    await v.cerrar();
  }
});
