/**
 * Autonomía del tanque: cuánto aguanta y por qué el número no debe bailar.
 *
 * Lo que estos tests protegen no es la aritmética —esa es trivial— sino las tres decisiones que la
 * hacen utilizable en planta: que el temporizador no se recalcule con el ruido del caudalímetro, que
 * con la entrada abierta no se finja un vaciado que no ocurre, y que cuando falta un dato se diga en
 * vez de inventar un número.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlantSnapshotDto, SignalDto } from '@ptap/shared';
import {
  analizarAutonomia,
  debeRecalcular,
  horasHasta,
  humanHoras,
  BANDA_MUERTA_LPS,
  SALTO_INMEDIATO_LPS,
  type TemporizadorTanque,
} from '../src/modules/notifications/tank-autonomy.analyzer';

const UN_MINUTO = 60_000;

function sig(value: number | null, over: Partial<SignalDto> = {}): SignalDto {
  return {
    value,
    unit: 'm',
    quality: 'Good',
    usable: value !== null,
    mappingStatus: 'mapped',
    confidence: 'confirmed',
    label: 'Nivel tanque 1',
    ts: new Date().toISOString(),
    ...over,
  } as SignalDto;
}

function snap(signals: Record<string, SignalDto>): PlantSnapshotDto {
  return {
    plantId: 'voragine',
    displayName: 'La Vorágine',
    sequence: 1,
    bridgeStatus: 'Connected',
    liveness: { state: 'live', lastChangeAt: null, windowSec: 300 },
    signals,
  } as PlantSnapshotDto;
}

/** Vorágine: máximo 1,98 m, y un área de 40 m² (volumen 60 m³ a nivel 1,5 m). */
function voragine(over: Record<string, SignalDto> = {}): PlantSnapshotDto {
  return snap({
    tank1Level: sig(1.5, { opMin: 1, opMax: 1.98 }),
    tank1Volume: sig(60, { unit: 'm³', label: 'Volumen tanque 1' }),
    inletFlow1: sig(0, { unit: 'l/s', label: 'Caudal de entrada' }),
    outletFlow1: sig(2, { unit: 'l/s', label: 'Caudal de salida' }),
    ...over,
  });
}

// ── La aritmética, con el ejemplo que dio el cliente ─────────────────────────────────────────
//
// El cliente dijo «80 m³ a 1,5 l/s serán 5 horas». No cuadra: 1,5 l/s son 5,4 m³/h y 80 ÷ 5,4 son
// 14,8 h. Para que fueran 5 h el caudal tendría que ser ~4,4 l/s. Este test deja el número a la
// vista para poder contrastarlo con la realidad de planta; si algún día la medición dice otra cosa,
// lo que está mal es una de las dos premisas, no el código.
test('aritmética: 80 m³ a 1,5 l/s son 14,8 h, no 5', () => {
  const horas = horasHasta(80, 1, 0, 1.5); // área 80 m², de 1 m a 0 → 80 m³
  assert.ok(horas !== null);
  assert.ok(Math.abs(horas - 14.81) < 0.02, `dio ${horas} h`);
});

test('sin área o sin caudal NO se inventa un número', () => {
  assert.equal(horasHasta(null, 1.5, 0, 2), null, 'sin volumen no hay área, y sin área no hay cuenta');
  assert.equal(horasHasta(40, 1.5, 0, 0), null, 'con caudal cero el tanque no se vacía nunca');
  assert.equal(horasHasta(40, 1.5, 0, -1), null);
});

test('si ya está por debajo del objetivo, son 0 horas y no un negativo', () => {
  assert.equal(horasHasta(40, 0.5, 0.99, 2), 0);
});

// ── El temporizador: lo que impide que el número parpadee ────────────────────────────────────

const PREVIO: TemporizadorTanque = {
  caudalFijadoLps: 2,
  fijadoEnMs: 1_000_000,
  horasHasta50: 5,
  horasHasta0: 10,
  origen: 'vaciado_real',
};

test('la primera vez siempre se fija', () => {
  assert.equal(debeRecalcular(undefined, 2, 0, UN_MINUTO).recalcular, true);
});

test('CLAVE: dentro de la banda muerta el reloj sigue corriendo, no se recalcula', () => {
  // El ruido normal de un caudalímetro no puede reescribir la autonomía cada minuto: un número que
  // salta de 5 h a 3 h y vuelve a 5 h no sirve para decidir nada.
  for (const caudal of [2, 2.1, 1.9, 2 + BANDA_MUERTA_LPS, 2 - BANDA_MUERTA_LPS]) {
    const r = debeRecalcular(PREVIO, caudal, PREVIO.fijadoEnMs + 10 * UN_MINUTO, UN_MINUTO);
    assert.equal(r.recalcular, false, `con caudal ${caudal} no debía recalcular`);
    assert.equal(r.motivo, 'banda_muerta');
  }
});

test('CLAVE: un salto de 0,6 l/s recalcula YA, sin esperar al minuto', () => {
  const r = debeRecalcular(PREVIO, 2 + SALTO_INMEDIATO_LPS, PREVIO.fijadoEnMs + 1, UN_MINUTO);
  assert.equal(r.recalcular, true);
  assert.equal(r.motivo, 'salto_de_regimen', 'esperar un minuto sería enseñar un número que ya se sabe falso');
});

test('entre la banda muerta y el salto, se recalcula en el tick del minuto', () => {
  const caudal = 2.4; // delta 0,4: ni ruido ni cambio de régimen
  const antes = debeRecalcular(PREVIO, caudal, PREVIO.fijadoEnMs + 30_000, UN_MINUTO);
  assert.equal(antes.recalcular, false, 'aún no ha pasado el minuto');

  const despues = debeRecalcular(PREVIO, caudal, PREVIO.fijadoEnMs + UN_MINUTO, UN_MINUTO);
  assert.equal(despues.recalcular, true);
  assert.equal(despues.motivo, 'tick');
});

// La comparación va contra el caudal con el que se FIJÓ el temporizador, no contra el del minuto
// anterior. Si fuera contra el anterior, una deriva de 0,15 l/s por minuto no dispararía nunca el
// recálculo y en media hora el número mostrado sería pura ficción.
test('CLAVE: una deriva lenta acaba disparando el recálculo', () => {
  let t = PREVIO.fijadoEnMs;
  let caudal = 2;
  let recalculado = false;
  for (let i = 0; i < 10; i++) {
    caudal += 0.15;
    t += UN_MINUTO;
    if (debeRecalcular(PREVIO, caudal, t, UN_MINUTO).recalcular) {
      recalculado = true;
      break;
    }
  }
  assert.ok(recalculado, 'una deriva sostenida no puede pasar desapercibida');
});

// ── Vaciado real vs proyección ───────────────────────────────────────────────────────────────

test('con la entrada CERRADA es una cuenta atrás real con el caudal de salida', () => {
  const [t] = analizarAutonomia(voragine(), null);
  assert.equal(t.origen, 'vaciado_real');
  assert.equal(t.caudalLps, 2);
  // área = 60/1,5 = 40 m². Hasta el 50 % (0,99 m): 40 × 0,51 = 20,4 m³ ÷ 7,2 m³/h = 2,83 h
  assert.ok(Math.abs((t.horasHasta50 as number) - 2.833) < 0.01, `dio ${t.horasHasta50}`);
  // Hasta vacío: 40 × 1,5 = 60 m³ ÷ 7,2 = 8,33 h
  assert.ok(Math.abs((t.horasHasta0 as number) - 8.333) < 0.01, `dio ${t.horasHasta0}`);
});

// LO QUE MÁS IMPORTA DE ESTA RAMA: con la entrada abierta el tanque NO se está vaciando. Presentar
// una cuenta atrás sería mentir sobre lo que está pasando; lo que el cliente pidió es un supuesto
// —«si cerraras ahora»— con el consumo típico del día.
test('con la entrada ABIERTA es una proyección con el promedio de 24 h, no el caudal de ahora', () => {
  const abierta = voragine({ inletFlow1: sig(5, { unit: 'l/s' }), outletFlow1: sig(2, { unit: 'l/s' }) });
  const [t] = analizarAutonomia(abierta, 1.5);
  assert.equal(t.origen, 'proyeccion_24h');
  assert.equal(t.caudalLps, 1.5, 'usa el promedio de 24 h, no los 2 l/s instantáneos');
});

test('con la entrada abierta y SIN 24 h de historia no se proyecta nada', () => {
  const abierta = voragine({ inletFlow1: sig(5, { unit: 'l/s' }) });
  assert.deepEqual(analizarAutonomia(abierta, null), [], 'mejor callar que promediar dos muestras');
});

test('un nivel negativo no produce autonomía: es un sensor que miente', () => {
  // Soledad reporta −1,51 m con timestamp fresco (signo invertido en el PLC). Calcularle una
  // autonomía sería darle crédito a una lectura imposible.
  const roto = voragine({ tank1Level: sig(-1.51, { opMin: 1, opMax: 1.98 }) });
  assert.deepEqual(analizarAutonomia(roto, null), []);
});

test('sin máximo declarado no hay porcentaje ni objetivo del 50 %', () => {
  const sinMax = voragine({ tank1Level: sig(1.5, { opMin: 1 }) });
  assert.deepEqual(analizarAutonomia(sinMax, null), []);
});

test('el porcentaje sale del máximo declarado (1,98 m en Vorágine)', () => {
  const [t] = analizarAutonomia(voragine(), null);
  assert.ok(Math.abs(t.pct - 75.76) < 0.01, `dio ${t.pct} %`);
  assert.equal(t.areaM2, 40);
});

test('humanHoras habla como un operador', () => {
  assert.equal(humanHoras(3), '3 h');
  assert.equal(humanHoras(3.333), '3 h 20 min');
  assert.equal(humanHoras(0.75), '45 min');
  assert.equal(humanHoras(0.001), '1 min', 'nunca «0 min»: si queda algo, es al menos un minuto');
});
