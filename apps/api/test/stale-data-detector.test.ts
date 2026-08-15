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

test('CLAVE: la frescura se evalúa POR SEÑAL, no por planta', () => {
  // El caso de Soledad en producción: 1 señal viva y varias congeladas hace días. Evaluando por
  // planta parecía fresca, y sus valores clavados salían como "fuera de rango" — cierto pero
  // engañoso, porque la causa es el sensor.
  const out = detector().detect(
    'Soledad',
    snapshot({
      fresco: signal({ ts: NOW.toISOString() }),
      viejo1: signal({ ts: hoursAgo(175), label: 'Cloro de salida' }),
      viejo2: signal({ ts: hoursAgo(175), label: 'pH de salida' }),
    }),
    NOW,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'sensor_stale');
  assert.match(out[0].title, /2 sensores sin refrescar/);
  assert.match(out[0].message, /2 de 3 señales/);
  assert.match(out[0].message, /Cloro de salida/);
});

test('si TODAS las señales están congeladas, el título habla de la planta entera', () => {
  const out = detector().detect(
    'KM18',
    snapshot({ a: signal({ ts: hoursAgo(367) }), b: signal({ ts: hoursAgo(367) }) }),
    NOW,
  );
  assert.equal(out[0].title, 'KM18: sensor sin refrescar');
  assert.match(out[0].message, /Ninguna señal de esta planta/);
  assert.equal(out[0].subject, null);
});

test('una sola señal congelada apunta al item exacto', () => {
  const out = detector().detect(
    'Sirena',
    snapshot({ ok: signal(), inletPh: signal({ ts: hoursAgo(30) }) }),
    NOW,
  );
  assert.equal(out[0].subject, 'inletPh', 'con una sola afectada se puede navegar a ella');
});

test('una señal congelada NO se juzga además por rango (apuntaría a la causa equivocada)', () => {
  const out = detector().detect(
    'Montebello',
    snapshot({ inletPh: signal({ ts: hoursAgo(20), value: 99, opMax: 8.5 }) }),
    NOW,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'sensor_stale');
});

test('conviven: una congelada y otra fresca fuera de rango generan DOS avisos distintos', () => {
  const out = detector().detect(
    'Sirena',
    snapshot({
      congelada: signal({ ts: hoursAgo(30) }),
      caliente: signal({ value: 99, opMax: 8.5 }),
    }),
    NOW,
  );
  assert.deepEqual(out.map((n) => n.kind).sort(), ['sensor_stale', 'signal_out_of_range']);
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

// Los NIVELES de tanque los interpreta TankLevelDetector (rebose vs máximo mal medido, y el
// mínimo de servicio). Dejarlos también aquí generaba DOS avisos del mismo hecho: visto en
// producción el 2026-08-15 con Carbonero y Vorágine, cada uno con `tank1` y `tank1Level`.
test('CLAVE: un nivel de tanque fuera de rango NO genera además el aviso genérico', () => {
  const d = detector();
  const fuera = { value: 2.96, unit: 'm', opMin: 1, opMax: 2.8, label: 'Nivel tanque 1' };

  const soloTanque = d.detect('Carbonero', snapshot({ tank1Level: signal(fuera) }, 'carbonero'), NOW);
  assert.equal(soloTanque.length, 0, 'el detector de tanques ya lo explica mejor');

  // Y la exclusión es SOLO para el nivel: el resto de señales sigue avisando igual.
  const conPresion = d.detect(
    'Carbonero',
    snapshot(
      {
        tank1Level: signal(fuera),
        outletPressure1: signal({ value: 300, unit: 'psi', opMin: 0, opMax: 232, label: 'Presión de salida' }),
      },
      'carbonero',
    ),
    NOW,
  );
  assert.equal(conPresion.length, 1);
  assert.equal(conPresion[0].subject, 'outletPressure1');
});

test('el VOLUMEN de tanque sí sigue en el aviso genérico (solo se excluye el nivel)', () => {
  const d = detector();
  const out = d.detect(
    'Carbonero',
    snapshot({ tank1Volume: signal({ value: 99999, unit: 'm³', opMax: 500, label: 'Volumen tanque 1' }) }, 'carbonero'),
    NOW,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].subject, 'tank1Volume');
});
