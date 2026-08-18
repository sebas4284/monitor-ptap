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
    // Etiqueta por defecto: el schema la exige en toda senal mapeada, y el detector NO publica
    // un aviso sin ella (antes ensenaba el domainKey crudo: «Soledad: outletFlow2 fuera de rango»).
    label: 'Caudal de entrada',
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
  assert.match(out[0].message, /17 horas/);
});

// La gravedad la da la ANTIGÜEDAD. Antes era `critical` por decreto para todo, así que un sensor
// con una hora de retraso pintaba el mismo rojo que una planta muerta hace 25 días — y con seis
// plantas congeladas a la vez la bandeja quedaba en rojo permanente, que es la forma más rápida de
// que el rojo deje de significar algo.
test('CLAVE: la severidad del sensor parado escala con la antigüedad', () => {
  const reciente = detector().detect('Montebello', snapshot({ f: signal({ ts: hoursAgo(2) }) }), NOW);
  assert.equal(reciente[0].severity, 'warning', 'dos horas no es una emergencia');

  const viejo = detector().detect('Montebello', snapshot({ f: signal({ ts: hoursAgo(25) }) }), NOW);
  assert.equal(viejo[0].severity, 'critical', 'pasado un día sí');

  // Que el salto de gravedad pueda avisar aunque ya se avisara ese día depende de que la clave de
  // deduplicación incluya la severidad (ver notification.repository).
  assert.notEqual(reciente[0].severity, viejo[0].severity);
});

test('el plural es correcto: 1 hora, no 1 horas', () => {
  const out = detector().detect('Montebello', snapshot({ f: signal({ ts: hoursAgo(1) }) }), NOW);
  assert.match(out[0].message, /tiene 1 hora\./, out[0].message);
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
  assert.match(out[0].title, /2 de 3 sensores sin refrescar/);
  assert.match(out[0].message, /2 de 3 señales/);
  assert.match(out[0].message, /Cloro de salida/);
});

test('si TODAS las señales están congeladas, el título habla de la planta entera', () => {
  const out = detector().detect(
    'KM18',
    snapshot({ a: signal({ ts: hoursAgo(367) }), b: signal({ ts: hoursAgo(367) }) }),
    NOW,
  );
  // El título estaba INVERTIDO: la planta completamente ciega decía «sensor sin refrescar»
  // —singular, sin número— y sonaba MENOS grave que «1 sensor sin refrescar» de una planta sana con
  // un sensor tonto caído. Fuera también el prefijo con el nombre de la planta, que se comía la
  // mitad de los ~40 caracteres que Android muestra de un título.
  assert.equal(out[0].title, 'Planta ciega: ningún dato se actualiza');
  assert.match(out[0].message, /Ninguna señal de esta planta/);
  assert.equal(out[0].subject, null);
});

// El `subject` es SIEMPRE la planta, nunca la señal suelta. Cuando dependía de cuántas señales
// estuvieran caídas (`stale.length === 1 ? key : null`), la clave de deduplicación cambiaba al pasar
// de una congelada a dos, y el MISMO problema se insertaba dos veces el mismo día.
test('CLAVE: el sujeto del aviso de sensores no depende de cuántos caigan', () => {
  const una = detector().detect('Sirena', snapshot({ ok: signal(), inletPh: signal({ ts: hoursAgo(30) }) }), NOW);
  const dos = detector().detect(
    'Sirena',
    snapshot({ ok: signal(), inletPh: signal({ ts: hoursAgo(30) }), otra: signal({ ts: hoursAgo(30) }) }),
    NOW,
  );
  assert.equal(una[0].subject, null);
  assert.equal(dos[0].subject, null, 'si cambiara, el mismo problema se avisaría dos veces el mismo día');
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

// LA SEVERIDAD ESTABA AL REVÉS, y estos dos tests son los que lo fijan. `outOfRange` significa
// fuera del rango FÍSICO, o sea que el instrumento miente: el nivel de -1,51 m de Soledad es un
// signo invertido en el PLC, no un problema de la planta, y salía CRÍTICO todos los días para
// siempre. Mientras tanto una turbiedad al doble del máximo normativo —agua que está saliendo así
// hacia las casas ahora mismo— salía en ámbar.
test('señal fuera del rango FÍSICO → instrumento roto, no emergencia', () => {
  const out = detector().detect('Sirena', snapshot({ inletPh: signal({ outOfRange: true }) }), NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'signal_out_of_range');
  assert.equal(out[0].severity, 'warning');
  assert.equal(out[0].subject, 'inletPh');
  assert.match(out[0].title, /lectura imposible/);
  assert.match(String(out[0].action), /instrumento/i, 'y dice a quién le toca arreglarlo');
});

test('señal fuera del rango OPERATIVO → CRÍTICO: el proceso es lo que hace daño', () => {
  const bajo = detector().detect('Sirena', snapshot({ inletPh: signal({ value: 2, opMin: 6.5 }) }), NOW);
  assert.equal(bajo[0].severity, 'critical');
  assert.match(bajo[0].message, /por debajo del mínimo/);

  const alto = detector().detect('Sirena', snapshot({ inletPh: signal({ value: 12, opMax: 8.5 }) }), NOW);
  assert.match(alto[0].message, /por encima del máximo/);
});

test('el valor se formatea: nada de flotantes crudos del PLC en pantalla', () => {
  const out = detector().detect(
    'Sirena',
    snapshot({ ph: signal({ value: 7.319999999999999, opMax: 7, label: 'pH' }) }),
    NOW,
  );
  assert.match(out[0].message, /pH marca 7\.32 /, out[0].message);
});

test('una señal sin etiqueta NO se publica: callar es mejor que enseñar un domainKey', () => {
  const out = detector().detect('Sirena', snapshot({ outletFlow2: signal({ outOfRange: true, label: null }) }), NOW);
  assert.equal(out.length, 0, 'el schema ya exige label; esto es la red por si se cuela');
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
