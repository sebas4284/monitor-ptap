import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SignalDto } from '@ptap/shared';
import { dashboardSignals, groupSignals, summarize } from './signal-groups';

function signal(over: Partial<SignalDto> = {}): SignalDto {
  return {
    value: 10,
    unit: 'l/s',
    quality: 'good',
    usable: true,
    mappingStatus: 'mapped',
    confidence: 'inferred',
    label: null,
    ts: null,
    ...over,
  } as SignalDto;
}

test('dashboardSignals excluye tanques y válvulas (tienen su propia tarjeta)', () => {
  const entries = dashboardSignals({
    inletFlow1: signal(),
    tank1Level: signal(),
    valve1: signal(),
    outletPh: signal(),
  });
  assert.deepEqual(
    entries.map(([k]) => k).sort(),
    ['inletFlow1', 'outletPh'],
  );
});

test('agrupa por dirección y descarta los grupos vacíos', () => {
  const groups = groupSignals(
    [
      ['inletFlow1', signal()],
      ['inletPh', signal()],
      ['conductivity', signal()],
    ],
    false,
  );
  assert.deepEqual(
    groups.map((g) => g.id),
    ['inlet', 'process'],
    'sin señales de salida, no debe existir el grupo "Salida"',
  );
  assert.equal(groups[0].entries.length, 2);
});

test('un grupo normal SÍ se puede plegar', () => {
  const [group] = groupSignals([['inletFlow1', signal()]], false);
  assert.equal(group.lockedOpen, false);
});

test('SEGURIDAD: un grupo con una señal fuera del rango FÍSICO NO se puede plegar', () => {
  const [group] = groupSignals(
    [
      ['inletFlow1', signal()],
      ['inletPh', signal({ outOfRange: true })],
    ],
    false,
  );
  assert.equal(group.lockedOpen, true, 'una anomalía nunca puede quedar detrás de un gesto');
  assert.equal(group.anomalyCount, 1);
});

test('SEGURIDAD: un valor por debajo de opMin cuenta como anomalía (igual que en la campana)', () => {
  // Este caso se escapaba cuando el tablero solo miraba `outOfRange`: la campana avisaba de la
  // señal pero su grupo se dejaba plegar. Ahora ambos usan `hasRangeAnomaly`.
  const [group] = groupSignals([['inletPh', signal({ value: 2, opMin: 6.5, opMax: 8.5 })]], false);
  assert.equal(group.anomalyCount, 1);
  assert.equal(group.lockedOpen, true);
});

test('SEGURIDAD: un valor por encima de opMax cuenta como anomalía', () => {
  const [group] = groupSignals([['inletPh', signal({ value: 12, opMin: 6.5, opMax: 8.5 })]], false);
  assert.equal(group.anomalyCount, 1);
  assert.equal(group.lockedOpen, true);
});

test('un valor DENTRO del rango operativo no es anomalía', () => {
  const [group] = groupSignals([['inletPh', signal({ value: 7, opMin: 6.5, opMax: 8.5 })]], false);
  assert.equal(group.anomalyCount, 0);
  assert.equal(group.lockedOpen, false);
});

test('SEGURIDAD: un grupo con una señal sin dato NO se puede plegar', () => {
  const [group] = groupSignals([['inletFlow1', signal({ value: null })]], false);
  assert.equal(group.lockedOpen, true);
  assert.equal(group.noDataCount, 1);
});

test('SEGURIDAD: con la planta congelada NINGÚN grupo se puede plegar', () => {
  const groups = groupSignals(
    [
      ['inletFlow1', signal()],
      ['outletPh', signal()],
    ],
    true,
  );
  assert.ok(
    groups.every((g) => g.lockedOpen),
    'en frío el operador tiene que ver todo lo que está mirando',
  );
});

test('el resumen se deriva de los grupos y suma sus conteos', () => {
  const groups = groupSignals(
    [
      ['inletFlow1', signal()],
      ['inletPh', signal({ outOfRange: true })],
      ['outletPh', signal({ value: null })],
      ['conductivity', signal({ value: 99, opMax: 50 })],
    ],
    false,
  );
  assert.deepEqual(summarize(groups), { total: 4, anomalies: 2, noData: 1 });
});
