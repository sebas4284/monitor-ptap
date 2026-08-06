/**
 * Detector de datos congelados y señales fuera de rango.
 *
 * El caso que motivó esto es real: el 2026-08-05 seis plantas llevaban entre 17 h y 15 días sin
 * refrescar su buffer OPC UA y la aplicación las mostraba como "proceso quieto, todo normal".
 * Estos tests fijan que eso no puede volver a pasar en silencio.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlantSnapshotDto, SignalDto } from '@ptap/shared';
import { StaleDataDetector } from '../src/modules/notifications/stale-data.detector';

const NOW = new Date('2026-08-05T23:00:00.000Z');

function signal(over: Partial<SignalDto> = {}): SignalDto {
  return {
    value: 10,
    unit: 'l/s',
    quality: 'good',
    usable: true,
    mappingStatus: 'mapped',
    confidence: 'inferred',
    label: null,
    ts: NOW.toISOString(),
    ...over,
  } as SignalDto;
}

function snapshot(signals: Record<string, SignalDto>, plantId = 'montebello'): PlantSnapshotDto {
  return {
    plantId,
    displayName: 'Montebello',
    sequence: 1,
    bridgeStatus: 'Connected',
    liveness: { state: 'stable', lastChangeAt: null, windowSec: 300 },
    signals,
  } as PlantSnapshotDto;
}

/** El detector solo necesita sus dependencias para `sweep()`; `detect()` es puro. */
function detector(): StaleDataDetector {
  return new StaleDataDetector(null as never, null as never, null as never);
}

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

test('dato fresco y en rango → ningún aviso', () => {
  const out = detector().detect('Montebello', snapshot({ inletFlow1: signal() }), NOW);
  assert.equal(out.length, 0);
});

test('CLAVE: dato de hace 17 h → avisa de sensor sin refrescar', () => {
  const out = detector().detect('Montebello', snapshot({ inletFlow1: signal({ ts: hoursAgo(17) }) }), NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'sensor_stale');
  assert.equal(out[0].severity, 'critical');
  assert.match(out[0].message, /17 horas/);
});

test('CLAVE: dato de hace 15 días → lo dice en días, no en horas', () => {
  const out = detector().detect('KM18', snapshot({ inletFlow1: signal({ ts: hoursAgo(367) }) }), NOW);
  assert.equal(out[0].kind, 'sensor_stale');
  assert.match(out[0].message, /15 días/);
});

test('justo por debajo del umbral (59 min) → todavía no avisa', () => {
  const out = detector().detect('Montebello', snapshot({ inletFlow1: signal({ ts: hoursAgo(59 / 60) }) }), NOW);
  assert.equal(out.length, 0);
});

test('la antigüedad se mide con la señal MÁS FRESCA de la planta', () => {
  // Una sola señal viva basta para que la planta no se considere congelada.
  const out = detector().detect(
    'Sirena',
    snapshot({ viejo: signal({ ts: hoursAgo(20) }), fresco: signal({ ts: NOW.toISOString() }) }),
    NOW,
  );
  assert.equal(out.length, 0);
});

test('con el dato congelado NO se añade además "fuera de rango" (sería ruido sobre un dato viejo)', () => {
  const out = detector().detect(
    'Montebello',
    snapshot({ inletPh: signal({ ts: hoursAgo(20), value: 99, opMax: 8.5 }) }),
    NOW,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'sensor_stale');
});

test('señal fuera del rango FÍSICO → aviso crítico', () => {
  const out = detector().detect('Sirena', snapshot({ inletPh: signal({ outOfRange: true }) }), NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'signal_out_of_range');
  assert.equal(out[0].severity, 'critical');
  assert.equal(out[0].subject, 'inletPh');
});

test('señal fuera del rango OPERATIVO → advertencia, y dice qué límite se cruzó', () => {
  const bajo = detector().detect('Sirena', snapshot({ inletPh: signal({ value: 2, opMin: 6.5 }) }), NOW);
  assert.equal(bajo[0].severity, 'warning');
  assert.match(bajo[0].message, /por debajo del mínimo/);

  const alto = detector().detect('Sirena', snapshot({ inletPh: signal({ value: 12, opMax: 8.5 }) }), NOW);
  assert.match(alto[0].message, /por encima del máximo/);
});

test('sin ningún timestamp no se inventa antigüedad', () => {
  const out = detector().detect('Quijote', snapshot({ inletFlow1: signal({ ts: null }) }), NOW);
  assert.equal(out.length, 0, 'sin evidencia de la hora del dato, no se puede afirmar que esté viejo');
});

test('la clave de deduplicación ancla al día → un aviso por problema y por día', () => {
  const d = detector();
  const hoy = d.detect('KM18', snapshot({ f: signal({ ts: hoursAgo(367) }) }, 'km18'), NOW);
  const manana = d.detect(
    'KM18',
    snapshot({ f: signal({ ts: hoursAgo(367) }) }, 'km18'),
    new Date(NOW.getTime() + 24 * 3_600_000),
  );
  assert.equal(hoy[0].day, '2026-08-05');
  assert.equal(manana[0].day, '2026-08-06', 'al día siguiente vuelve a avisar del mismo problema');
});
