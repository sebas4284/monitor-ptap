/**
 * Autonomía del tanque: cuánto aguanta y por qué el número no debe bailar.
 *
 * Lo que estos tests protegen no es la aritmética —esa es trivial— sino las tres decisiones que la
 * hacen utilizable en planta: que el temporizador no se recalcule con el ruido del caudalímetro, que
 * con la entrada abierta no se finja un vaciado que no ocurre, y que cuando falta un dato se diga en
 * vez de inventar un número.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlantSnapshotDto, SignalDto } from '@ptap/shared';
import {
  analizarAutonomia,
  aplicarTendencia,
  debeRecalcular,
  horasHasta,
  humanHoras,
  BANDA_MUERTA_LPS,
  type TemporizadorTanque,
  type MuestraTanque,
} from '../src/modules/notifications/tank-autonomy.analyzer';
import { TankAutonomyDetector } from '../src/modules/notifications/tank-autonomy.detector';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { TankAutonomyStore } from '../src/infrastructure/connectivity/pipeline/tank-autonomy.store';
import type { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import type { NotificationRepository } from '../src/modules/notifications/notification.repository';
import type { FlowHourlyRepository } from '../src/modules/notifications/flow-hourly.repository';

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

test('CLAVE: los bordes exactos de los 0,3 l/s que pidió operación', () => {
  // La banda es INCLUSIVA: exactamente 0,3 todavía no recalcula. Se fija aquí porque es la clase de
  // detalle que se cambia sin querer al tocar una comparación, y el usuario dio la cifra exacta.
  const enElBorde = debeRecalcular(PREVIO, 2.3, PREVIO.fijadoEnMs + 10 * UN_MINUTO, UN_MINUTO);
  assert.equal(enElBorde.recalcular, false, '0,30 exacto sigue dentro de la banda');

  assert.equal(debeRecalcular(PREVIO, 2.29, PREVIO.fijadoEnMs + 10 * UN_MINUTO, UN_MINUTO).recalcular, false);
  assert.equal(debeRecalcular(PREVIO, 1.71, PREVIO.fijadoEnMs + 10 * UN_MINUTO, UN_MINUTO).recalcular, false);

  // Y justo al otro lado, arriba y abajo: la regla es simétrica.
  assert.equal(debeRecalcular(PREVIO, 2.31, PREVIO.fijadoEnMs + 10 * UN_MINUTO, UN_MINUTO).recalcular, true);
  assert.equal(debeRecalcular(PREVIO, 1.69, PREVIO.fijadoEnMs + 10 * UN_MINUTO, UN_MINUTO).recalcular, true);
});

test('fuera de la banda, se recalcula en el tick del minuto', () => {
  const caudal = 2.4; // delta 0,4: fuera de la banda muerta
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

test('entrada cerrada no demuestra conexión del caudal global al tanque', () => {
  const [t] = analizarAutonomia(voragine(), null);
  assert.equal(t.origen, 'proyeccion_actual');
  assert.equal(t.caudalLps, 2);
  assert.equal(t.horasHasta50, null);
  assert.equal(t.horasHasta0, null);
  assert.equal(t.limitacion, 'unmapped_flow');
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

test('sin historia se conserva stock y no se inventa una duración', () => {
  const abierta = voragine({ inletFlow1: sig(5, { unit: 'l/s' }) });
  const [t] = analizarAutonomia(abierta, null);
  assert.equal(t.horasHasta0, null);
  assert.equal(t.origen, 'proyeccion_actual');
});

test('un nivel negativo no produce autonomía: es un sensor que miente', () => {
  // Soledad reporta −1,51 m con timestamp fresco (signo invertido en el PLC). Calcularle una
  // autonomía sería darle crédito a una lectura imposible.
  const roto = voragine({ tank1Level: sig(-1.51, { opMin: 1, opMax: 1.98 }) });
  assert.deepEqual(analizarAutonomia(roto, null), []);
});

test('sin máximo se conserva nivel y reserva operativa, sin inventar porcentaje ni 50 %', () => {
  const sinMax = voragine({ tank1Level: sig(1.5, { opMin: 1 }) });
  const [t] = analizarAutonomia(sinMax, null);
  assert.equal(t.pct, null);
  assert.equal(t.horasHasta50, null);
  assert.equal(t.reservaM, 1);
  assert.equal(t.reservaOrigen, 'op_min');
});

test('el porcentaje sale del máximo declarado (1,98 m en Vorágine)', () => {
  const [t] = analizarAutonomia(voragine(), null);
  assert.ok(Math.abs(t.pct! - 75.76) < 0.01, `dio ${t.pct} %`);
  assert.equal(t.areaM2, 40);
});

test('humanHoras habla como un operador', () => {
  assert.equal(humanHoras(3), '3 h');
  assert.equal(humanHoras(3.333), '3 h 20 min');
  assert.equal(humanHoras(0.75), '45 min');
  assert.equal(humanHoras(0.001), '1 min', 'nunca «0 min»: si queda algo, es al menos un minuto');
  assert.equal(humanHoras(0), '0 min');
  assert.equal(humanHoras(1.999), '2 h');
});

const BASE_MS = Date.parse('2026-11-02T10:00:00Z');
function descenso(volumen = true): MuestraTanque[] {
  return Array.from({ length: 6 }, (_, i) => ({ tsMs: BASE_MS + i * UN_MINUTO, nivelM: 1.5 - i * 0.015, volumenM3: volumen ? 60 - i * 0.6 : null }));
}

test('descenso propio permite autonomía sin válvulas ni caudal conectado', () => {
  const [stock] = analizarAutonomia(snap({ tank1Level: sig(1.425, { opMin: 1, opMax: 1.98 }), tank1Volume: sig(57) }), null);
  const t = aplicarTendencia(stock, descenso(), BASE_MS + 5 * UN_MINUTO);
  assert.equal(t.origen, 'tendencia_volumen');
  assert.equal(t.limitacion, null);
  assert.ok(Math.abs(t.caudalLps - 10) < 1e-9);
  assert.ok(Math.abs(t.horasHasta0! - 57 / 36) < 1e-9);
  assert.ok(Math.abs(t.horasHastaReserva! - 17 / 36) < 1e-9);
});

test('solo nivel: deriva propia hasta reserva sin inventar volumen ni l/s', () => {
  const [stock] = analizarAutonomia(snap({ tank1Level: sig(1.425, { opMin: 1 }) }), null);
  const t = aplicarTendencia(stock, descenso(false), BASE_MS + 5 * UN_MINUTO);
  assert.equal(t.origen, 'tendencia_nivel');
  assert.equal(t.caudalLps, 0);
  assert.ok(Math.abs(t.horasHasta0! - 1.425 / 0.9) < 1e-9);
  assert.ok(Math.abs(t.horasHastaReserva! - 0.425 / 0.9) < 1e-9);
  assert.equal(t.horasHasta50, null);
});

test('opMin ausente usa 50 % como reserva identificada explícitamente', () => {
  const [stock] = analizarAutonomia(voragine({ tank1Level: sig(1.425, { opMax: 2 }) }), null);
  assert.equal(stock.reservaM, 1);
  assert.equal(stock.reservaOrigen, '50_percent');
});

test('pocas muestras, huecos, ruido, llenado y datos viejos no prueban un vaciado', () => {
  const [stock] = analizarAutonomia(voragine(), null);
  const histories: MuestraTanque[][] = [
    descenso().slice(0, 2),
    descenso().map((m, i) => ({ ...m, tsMs: BASE_MS + i * 4 * UN_MINUTO })),
    descenso().map((m, i) => ({ ...m, volumenM3: 60 + i })),
    descenso().map((m, i) => ({ ...m, volumenM3: 60 - i * 0.01 })),
    descenso().map((m, i) => ({ ...m, volumenM3: [60, 90, 10, 80, 20, 57][i] })),
  ];
  for (const history of histories) assert.equal(aplicarTendencia(stock, history, BASE_MS + 5 * UN_MINUTO).horasHasta0, null);
  assert.equal(aplicarTendencia(stock, descenso(), BASE_MS + 8 * UN_MINUTO).horasHasta0, null);
});

test('dos tanques requieren y usan tendencias independientes', () => {
  const stocks = analizarAutonomia(voragine({ tank2Level: sig(2, { opMin: 1 }), tank2Volume: sig(80) }), null);
  assert.ok(stocks.every((t) => t.horasHasta0 === null && t.limitacion === 'multiple_tanks'));
  const a = aplicarTendencia(stocks[0], descenso(), BASE_MS + 5 * UN_MINUTO);
  const b = aplicarTendencia(stocks[1], descenso().map((m, i) => ({ ...m, nivelM: 2 - i * 0.005, volumenM3: 80 - i * 0.2 })), BASE_MS + 5 * UN_MINUTO);
  assert.equal(a.limitacion, null);
  assert.equal(b.limitacion, null);
  assert.ok(b.horasHasta0! > a.horasHasta0! * 2);
});

test('calidad inválida y niveles/volúmenes imposibles no producen horas', () => {
  for (const bad of [{ usable: false }, { quality: 'Bad' as const }, { outOfRange: true }, { value: NaN }]) {
    assert.deepEqual(analizarAutonomia(voragine({ tank1Level: sig(1.5, bad) }), null), []);
  }
  const [t] = analizarAutonomia(voragine({ tank1Volume: sig(-60) }), null);
  assert.equal(t.volumeM3, null);
  const frozen = voragine(); frozen.liveness.state = 'frozen';
  assert.deepEqual(analizarAutonomia(frozen, null), []);
});

test('reserva alcanzada y vacío congruente son hechos medidos aun sin historia', () => {
  const [low] = analizarAutonomia(voragine({ tank1Level: sig(0.9, { opMin: 1, opMax: 2 }) }), null);
  assert.equal(low.horasHastaReserva, 0);
  assert.equal(low.horasHasta50, 0);
  assert.equal(low.horasHasta0, null);
  const [empty] = analizarAutonomia(voragine({ tank1Level: sig(0, { opMin: 1, opMax: 2 }), tank1Volume: sig(0) }), null);
  assert.equal(empty.horasHasta0, 0);
});

test('estabilización/llenado reciente y nivel que contradice volumen invalidan tendencia', () => {
  const [stock] = analizarAutonomia(voragine(), null);
  const histories: MuestraTanque[][] = [
    [60, 59, 58, 57, 57, 57],
    [60, 59, 58, 57, 57.1, 57.2],
  ].map((volumes) => descenso().map((m, i) => ({ ...m, volumenM3: volumes[i], nivelM: volumes[i] / 40 })));
  histories.push(descenso().map((m) => ({ ...m, nivelM: 1.5 })));
  histories.push(descenso().map((m, i) => ({ ...m, nivelM: 1.5 + i * 0.015 })));
  for (const history of histories) assert.equal(aplicarTendencia(stock, history, BASE_MS + 5 * UN_MINUTO).horasHasta0, null);
});

test('mapping de las 16 plantas: cubre 16 tanques, incluidos externos, sin caudales ni válvulas', () => {
  const mapping = JSON.parse(readFileSync(join(__dirname, '../config/opc_mapping.json'), 'utf8')) as {
    plants: { plantId: string; signals: { domainKey: string; label?: string; opMin?: number; opMax?: number }[] }[];
  };
  assert.equal(mapping.plants.length, 16);
  const discovered: string[] = [];
  for (const plant of mapping.plants) {
    const signals: Record<string, SignalDto> = {};
    for (const s of plant.signals.filter((s) => /^(tank\d+|sanAntonioTank|quijoteTank)(Level|Volume)$/.test(s.domainKey))) {
      signals[s.domainKey] = sig(s.domainKey.endsWith('Level') ? 1.425 : 57, { label: s.label ?? s.domainKey, opMin: s.opMin, opMax: s.opMax });
    }
    const snapshot = { ...snap(signals), plantId: plant.plantId };
    for (const stock of analizarAutonomia(snapshot, null)) {
      discovered.push(`${plant.plantId}/${stock.tankKey}`);
      const t = aplicarTendencia(stock, descenso(), BASE_MS + 5 * UN_MINUTO);
      assert.equal(t.origen, 'tendencia_volumen', `${plant.plantId}/${stock.tankKey}`);
      assert.ok(t.horasHasta0 !== null && Number.isFinite(t.horasHasta0));
    }
  }
  assert.equal(discovered.length, 16);
  assert.ok(discovered.includes('soledad/sanAntonioTank'));
  assert.ok(discovered.includes('soledad/quijoteTank'));
});

test('barridos actualizan stock dentro de banda y descartan muestras duplicadas o congeladas', async () => {
  const cache = new PlantCache();
  const store = new TankAutonomyStore();
  const detector = new TankAutonomyDetector(
    { listPlants: () => [{ plantId: 'voragine' }] } as unknown as PlantPipelineService,
    cache,
    { create: async () => true } as unknown as NotificationRepository,
    { promedio: async () => ({ avgLps: 20, horas: 1 }), upsert: async () => undefined } as unknown as FlowHourlyRepository,
    store,
  );
  const write = (i: number) => {
    const ts = new Date(BASE_MS + i * UN_MINUTO).toISOString();
    cache.write(voragine({ tank1Level: sig((60 - i * 0.6) / 40, { opMin: 1, opMax: 1.98, ts }), tank1Volume: sig(60 - i * 0.6, { ts }) }));
  };
  for (let i = 0; i <= 5; i++) { write(i); await detector.sweep(new Date(BASE_MS + i * UN_MINUTO)); }
  const first = store.get('voragine')[0];
  assert.equal(first.basis, 'tendencia_volumen');
  assert.ok(Math.abs(first.flowLps - 10) < 1e-9);
  write(6); await detector.sweep(new Date(BASE_MS + 6 * UN_MINUTO));
  const next = store.get('voragine')[0];
  assert.ok(next.hoursTo0! < first.hoursTo0!, 'caudal estable no congela stock');
  await detector.sweep(new Date(BASE_MS + 6 * UN_MINUTO));
  assert.equal(store.get('voragine')[0].hoursTo0, next.hoursTo0);
  const frozen = cache.get('voragine')!; frozen.liveness.state = 'frozen';
  await detector.sweep(new Date(BASE_MS + 7 * UN_MINUTO));
  assert.deepEqual(store.get('voragine'), []);
  write(8); await detector.sweep(new Date(BASE_MS + 8 * UN_MINUTO));
  assert.equal(store.get('voragine')[0].hoursTo0, null, 'reconexión requiere ventana nueva');
});

test('nivel viejo bajo mínimo no se publica ni dispara aviso aunque siga usable', async () => {
  const cache = new PlantCache();
  const store = new TankAutonomyStore();
  let avisos = 0;
  const detector = new TankAutonomyDetector(
    { listPlants: () => [{ plantId: 'voragine' }] } as unknown as PlantPipelineService,
    cache,
    { create: async () => { avisos++; return true; } } as unknown as NotificationRepository,
    { promedio: async () => { throw new Error('la tendencia no consulta promedios'); } } as unknown as FlowHourlyRepository,
    store,
  );
  cache.write(voragine({ tank1Level: sig(0.5, { opMin: 1, opMax: 2, ts: new Date(BASE_MS).toISOString() }) }));
  await detector.sweep(new Date(BASE_MS + 3 * UN_MINUTO));
  assert.deepEqual(store.get('voragine'), []);
  assert.equal(avisos, 0);
});
