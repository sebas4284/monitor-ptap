import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SignalDto } from '@ptap/shared';
import { filterReadings, readingState, type SignalEntry } from './dashboard-view';

test('reading filters combine accent-insensitive search and status without changing the input', () => {
  const entries: SignalEntry[] = [
    ['pressure', { label: 'Presión', value: 5, opMax: 3, unit: 'psi' } as SignalDto],
    ['flow', { label: 'Caudal', value: 0, unit: 'l/s' } as SignalDto],
    ['level', { label: 'Nivel', value: null } as SignalDto],
  ];
  assert.deepEqual(
    filterReadings(entries, 'presion', 'alert').map(([key]) => key),
    ['pressure'],
  );
  assert.equal(filterReadings(entries, 'psi', 'ok').length, 0);
  assert.equal(readingState(entries[1][1]), 'ok');
  assert.equal(readingState(entries[2][1]), 'missing');
  assert.equal(readingState({ value: NaN } as SignalDto), 'missing');
  assert.equal(entries[0][0], 'pressure');
});
