import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BridgeStatus, LivenessState, PlantListItem } from '@ptap/shared';
import { filterRows, normalize, pickerRows } from './plant-picker';

const PLANTS = [
  { id: 'voragine', name: 'La Vorágine' },
  { id: 'pichinde', name: 'Pichindé' },
  { id: 'quijote', name: 'El Quijote' },
  { id: 'sirena', name: 'La Sirena' },
];
const NOW = new Date(2026, 10, 5, 12, 0);

const item = (
  plantId: string,
  state: LivenessState,
  bridgeStatus: BridgeStatus = 'Connected',
): PlantListItem => ({
  plantId,
  displayName: plantId,
  liveness: { state, lastChangeAt: null, windowSec: 60 },
  bridgeStatus,
});

// sirena no viene del servidor: su estado es desconocido.
const LIVE = [
  item('voragine', 'live'),
  item('pichinde', 'frozen'),
  item('quijote', 'live', 'Disconnected'),
];
const names = (rows: ReturnType<typeof filterRows>) => rows.map((r) => r.plant.id);

test('plant-picker: normalize ignora tildes y mayúsculas', () => {
  assert.equal(normalize('  Pichindé '), 'pichinde');
});

test('plant-picker: conserva el orden del catálogo y no inventa estado a la planta ausente', () => {
  const rows = pickerRows(PLANTS, LIVE, NOW);
  assert.deepEqual(names(rows), ['voragine', 'pichinde', 'quijote', 'sirena']);
  assert.equal(rows[3].status, null);
  assert.ok(pickerRows(PLANTS, undefined, NOW).every((r) => r.status === null));
});

test('plant-picker: filtros En línea / Sin conexión; lo desconocido solo en Todas', () => {
  const rows = pickerRows(PLANTS, LIVE, NOW);
  assert.deepEqual(names(filterRows(rows, '', 'todas')), [
    'voragine',
    'pichinde',
    'quijote',
    'sirena',
  ]);
  assert.deepEqual(names(filterRows(rows, '', 'linea')), ['voragine']);
  assert.deepEqual(names(filterRows(rows, '', 'sin')), ['pichinde', 'quijote']);
});

test('plant-picker: la búsqueda se combina con el filtro', () => {
  const rows = pickerRows(PLANTS, LIVE, NOW);
  assert.deepEqual(names(filterRows(rows, 'pichinde', 'todas')), ['pichinde']);
  assert.deepEqual(names(filterRows(rows, 'la ', 'linea')), ['voragine']);
  assert.deepEqual(names(filterRows(rows, 'zzz', 'todas')), []);
});
