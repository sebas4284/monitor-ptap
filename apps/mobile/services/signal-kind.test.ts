import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardKindFor, directionFor } from './signal-kind';

test('cardKindFor: caudal (Flow) usa la tarjeta flow', () => {
  assert.equal(cardKindFor('inletFlow1'), 'flow');
  assert.equal(cardKindFor('outletFlow2'), 'flow');
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
