import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseAt, phaseRange } from './loop-phase';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-4, `${a} ≉ ${b}`);

test('loop-phase: sin desfase es la identidad', () => {
  assert.deepEqual(phaseRange(0), { inputRange: [0, 1], outputRange: [0, 1] });
  assert.deepEqual(phaseRange(1), phaseRange(0));
});

test('loop-phase: adelanta el bucle y vuelve a 0 al llegar a 1', () => {
  near(phaseAt(0, 0.25), 0.25);
  near(phaseAt(0.5, 0.25), 0.75);
  near(phaseAt(0.75, 0.25), 1);
  near(phaseAt(0.8, 0.25), 0.05);
  near(phaseAt(1, 0.25), 0.25); // fin de vuelta = principio: el bucle no salta
});

test('loop-phase: tres anillos a 1/3 quedan siempre repartidos', () => {
  for (const t of [0, 0.1, 0.4, 0.66, 0.9]) {
    const p = [0, 1, 2].map((i) => phaseAt(t, i / 3)).sort((a, b) => a - b);
    near(p[1] - p[0], 1 / 3);
    near(p[2] - p[1], 1 / 3);
  }
});

test('loop-phase: inputRange estrictamente creciente (requisito de interpolate)', () => {
  for (const o of [0.1, 0.5, 0.99, -0.25]) {
    const { inputRange } = phaseRange(o);
    inputRange.slice(1).forEach((x, i) => assert.ok(x > inputRange[i]));
  }
});
