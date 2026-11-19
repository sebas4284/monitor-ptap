import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wavePath, WAVE_MID, WAVE_PERIOD } from './wave-path';

/** Puntos finales (x, y) de cada comando M/Q/T del trazado, sin los puntos de control. */
function anchors(path: string): [number, number][] {
  return path
    .split(' ')
    .reduce<string[][]>((acc, tok) => {
      if (/^[A-Z]/.test(tok)) acc.push([tok]);
      else acc[acc.length - 1].push(tok);
      return acc;
    }, [])
    .filter(([cmd]) => /^[MQT]/.test(cmd))
    .map(parts => {
      const nums = parts.join(' ').slice(1).trim().split(/\s+/).map(Number);
      return [nums[nums.length - 2], nums[nums.length - 1]];
    });
}

test('la ola empieza y termina a la misma altura y cubre todo el ancho', () => {
  const pts = anchors(wavePath(4, 10));
  assert.deepEqual(pts[0], [0, WAVE_MID]);
  assert.deepEqual(pts[pts.length - 1], [4 * WAVE_PERIOD, WAVE_MID]);
});

test('cada media ola cae sobre la línea media: el trazado es periódico y el bucle no salta', () => {
  const pts = anchors(wavePath(6, 14));
  assert.equal(pts.length, 6 * 2 + 1);
  pts.forEach(([x, y], i) => {
    assert.equal(x, (i * WAVE_PERIOD) / 2);
    assert.equal(y, WAVE_MID);
  });
});

test('la cresta alcanza la amplitud pedida', () => {
  // Control de la primera Q en y = MID − 2·amp → pico de la curva en MID − amp.
  assert.match(wavePath(2, 12), new RegExp(`^M0 ${WAVE_MID} Q25 ${WAVE_MID - 24} 50 ${WAVE_MID}`));
});

test('rechaza parámetros que romperían el bucle o saldrían del viewBox', () => {
  assert.throws(() => wavePath(3, 10), /par/);
  assert.throws(() => wavePath(0, 10), /par/);
  assert.throws(() => wavePath(2, 0), /amplitude/);
  assert.throws(() => wavePath(2, 60), /amplitude/);
});
