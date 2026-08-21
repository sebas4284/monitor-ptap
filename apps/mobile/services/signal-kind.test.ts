import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardKindFor, directionFor } from './signal-kind';

// Los caudales dejaron de usar la tarjeta con barra el 2026-08-21. La barra solo aparecía cuando la
// señal declaraba opMin/opMax, y hasta ese día ningún caudal los tenía: al declarar el rango del
// caudal de salida de La Vorágine —para poder AVISAR fuera de 1-3 l/s— la barra apareció sola y dejó
// la entrada y la salida de la misma planta con dos estilos. Declarar un rango para alarmar no debe
// cambiar de paso el aspecto de la tarjeta.
test('cardKindFor: los caudales usan la MISMA tarjeta que el resto', () => {
  assert.equal(cardKindFor('inletFlow1'), 'gauge');
  assert.equal(cardKindFor('outletFlow2'), 'gauge');
  // Case-insensitivity: FLOW in any case should match
  assert.equal(cardKindFor('someFLOWkey'), 'gauge');
});

test('cardKindFor: todo lo que no es caudal usa gauge', () => {
  assert.equal(cardKindFor('inletPressure1'), 'gauge');
  assert.equal(cardKindFor('inletPh'), 'gauge');
  assert.equal(cardKindFor('tank1Level'), 'gauge');
});

test('directionFor: detecta entrada y salida por prefijo', () => {
  assert.equal(directionFor('inletFlow1'), 'inlet');
  assert.equal(directionFor('outletPressure1'), 'outlet');
});

test('directionFor: null cuando no hay prefijo de dirección', () => {
  assert.equal(directionFor('tank1Level'), null);
  assert.equal(directionFor('conductivity'), null);
});
