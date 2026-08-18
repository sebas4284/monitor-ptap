/**
 * Acumulación de evidencia sobre la palabra de estado de las válvulas.
 *
 * Por qué existe: nadie sabe qué significan los bits de `INT_IN[0]`. La única interpretación que
 * teníamos (bit14 = válido, bit0 = abierta, del protocolo de Vorágine) **no la cumple ni la propia
 * Vorágine** — su palabra hoy es 7176, sin bit14. Cada valor nuevo había que investigarlo a mano:
 * así se descubrió por casualidad el 2026-08-15 que Sirena había pasado de 16384 a 17408 con
 * 23,33 l/s entrando, y que la app llevaba tiempo diciendo CERRADA.
 *
 * El observador convierte ese hallazgo casual en registro sistemático: cada valor nunca visto se
 * anota junto al CAUDAL de esa válvula, que es la evidencia física. Con muestras suficientes la
 * convención se deduce en vez de suponerse.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlantSnapshotDto, SignalDto } from '@ptap/shared';
import { AuditLogService, type AuditEntry } from '../src/infrastructure/audit/audit-log.service';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { ValveStateObserver, VALVE_STATE_EVENT } from '../src/modules/notifications/valve-state.observer';

function sig(value: number, over: Partial<SignalDto> = {}): SignalDto {
  return {
    value,
    unit: null,
    quality: 'Good',
    usable: true,
    mappingStatus: 'mapped',
    confidence: 'inferred',
    label: null,
    ts: '2026-08-15T20:00:00.000Z',
    ...over,
  } as SignalDto;
}

function snap(signals: Record<string, SignalDto>): PlantSnapshotDto {
  return {
    plantId: 'sirena',
    displayName: 'La Sirena',
    sequence: 1,
    bridgeStatus: 'Connected',
    liveness: { state: 'live', lastChangeAt: null, windowSec: 300 },
    signals,
  } as PlantSnapshotDto;
}

/** Observador con dobles: pipeline con una planta, cache que devuelve el snapshot dado. */
function observador(snapshot: PlantSnapshotDto, previos: AuditEntry[] = []) {
  const registros: AuditEntry[] = [];
  const audit = {
    record: async (e: AuditEntry) => {
      registros.push(e);
    },
    listByEventType: async () =>
      previos.map((e) => ({ at: '2026-08-15T00:00:00.000Z', eventType: VALVE_STATE_EVENT, detail: e.detail ?? null })),
  } as unknown as AuditLogService;

  const pipeline = { listPlants: () => [{ plantId: 'sirena', displayName: 'La Sirena' }] } as unknown as PlantPipelineService;
  const cache = { get: () => snapshot } as unknown as PlantCache;

  return { obs: new ValveStateObserver(pipeline, cache, audit), registros };
}

test('observador: un valor NUNCA visto se registra con el caudal de esa válvula', async () => {
  const { obs, registros } = observador(
    snap({
      valve1: sig(0, { flowDomainKey: 'outletFlow1' }),
      valve1State: sig(17408, { stateTrusted: false }),
      outletFlow1: sig(19.66, { unit: 'l/s' }),
      inletFlow1: sig(0, { unit: 'l/s' }), // NO debe usarse: la valvula de Sirena es la de SALIDA
    }),
  );

  assert.equal(await obs.sweep(), 1);
  const d = registros[0].detail as Record<string, unknown>;
  assert.equal(registros[0].eventType, VALVE_STATE_EVENT);
  assert.equal(d.motivo, 'valor_nuevo');
  assert.equal(d.palabra, 17408);
  assert.deepEqual(d.bits, [10, 14]);
  assert.equal(d.caudal, 19.66, 'el caudal DECLARADO para esa válvula, no otro que haya en la planta');
  assert.equal(d.estadoPorCaudal, 'abierta', 'la evidencia física: con 19,66 l/s la válvula deja pasar agua');
  assert.equal(d.palabraFiable, false);
});

test('observador: el mismo valor no se vuelve a registrar en cada barrido', async () => {
  const { obs, registros } = observador(
    snap({ valve1: sig(0), valve1State: sig(16384), outletFlow1: sig(0, { unit: 'l/s' }) }),
  );
  assert.equal(await obs.sweep(), 1);
  assert.equal(await obs.sweep(), 0, 'ya lo conocemos: registrarlo otra vez sería ruido');
  assert.equal(registros.length, 1);
});

test('observador: al arrancar se siembra con lo YA registrado (un reinicio no re-descubre nada)', async () => {
  const previo: AuditEntry = {
    eventType: VALVE_STATE_EVENT,
    userId: null, userEmail: null, role: null, ip: null, method: null, path: null, statusCode: null,
    detail: { clave: 'sirena/valve1', palabra: 17408 },
  };
  const { obs, registros } = observador(
    snap({ valve1: sig(0), valve1State: sig(17408), inletFlow1: sig(23, { unit: 'l/s' }) }),
    [previo],
  );
  await obs.onModuleInit();
  obs.onModuleDestroy();
  assert.equal(await obs.sweep(), 0, 'ese valor ya estaba en la auditoría');
  assert.equal(registros.length, 0);
});

// La huella del movimiento MANUAL desde el tablero: alguien mueve la válvula, el agua responde,
// y el registro del PLC se queda igual. Prueba de que esa palabra no sigue a la válvula.
test('observador: el caudal cambia de lado y la palabra NO se mueve → queda registrado', async () => {
  const signals: Record<string, SignalDto> = {
    valve1: sig(0, { flowDomainKey: 'outletFlow1' }),
    valve1State: sig(16384),
    outletFlow1: sig(20, { unit: 'l/s' }),
  };
  const { obs, registros } = observador(snap(signals));

  await obs.sweep(); // primera vuelta: registra 16384 como valor nuevo, con caudal
  registros.length = 0;

  signals.outletFlow1 = sig(0, { unit: 'l/s' }); // se cerró a mano; la palabra sigue en 16384
  assert.equal(await obs.sweep(), 1);
  const d = registros[0].detail as Record<string, unknown>;
  assert.equal(d.motivo, 'caudal_cambio_palabra_no');
  assert.equal(d.palabra, 16384);
  assert.equal(d.estadoPorCaudal, 'cerrada');
});

test('observador: sin caudal mapeado se dice, no se inventa', async () => {
  const { obs, registros } = observador(snap({ valve1: sig(0), valve1State: sig(21) }));
  await obs.sweep();
  const d = registros[0].detail as Record<string, unknown>;
  assert.equal(d.caudal, null);
  assert.equal(d.estadoPorCaudal, 'sin caudal mapeado');
});

test('observador: una planta sin palabra de estado no genera nada', async () => {
  const { obs, registros } = observador(snap({ valve1: sig(0), inletFlow1: sig(20, { unit: 'l/s' }) }));
  assert.equal(await obs.sweep(), 0);
  assert.equal(registros.length, 0);
});
