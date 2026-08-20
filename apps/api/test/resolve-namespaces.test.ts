/**
 * Tests de la política de resolución de namespaces (FASE 0.2, arreglo 3).
 * Ejecutar: npm run test:mapping
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { resolveNamespaces, collectNsUris, NamespaceNotFoundError } from '../scripts/resolve-namespaces';

const mapping = JSON.parse(
  readFileSync(join(__dirname, '..', 'config', 'opc_mapping.json'), 'utf8'),
) as { generatedFrom: { namespaces: string[] }; plants: unknown[] };

// NamespaceArray real capturado, guardado en el propio mapping como referencia.
const REAL_NS = mapping.generatedFrom.namespaces;

// El 2026-08-20 la planta reconfiguró el servidor OPC UA —puerto nuevo y autenticación— y en el
// proceso el namespace pasó de `AQUATECH` a `AQUATECH4`. El índice siguió siendo el 9, así que las
// lecturas crudas por `ns=9` no se enteraron; el puente sí, porque resuelve por URI, y entró en
// Faulted en vez de leer a ciegas del namespace equivocado. Esa negativa a adivinar es lo que
// convirtió un cambio silencioso en un error visible.
test('el mapping real usa únicamente el nsUri AQUATECH4', () => {
  assert.deepEqual(collectNsUris(mapping), ['AQUATECH4']);
});

test('resuelve AQUATECH4 a su índice con el NamespaceArray real', () => {
  const resolved = resolveNamespaces(REAL_NS, mapping);
  assert.equal(resolved.get('AQUATECH4'), REAL_NS.indexOf('AQUATECH4'));
  assert.equal(resolved.get('AQUATECH4'), 9); // índice observado en la captura del 2026-08-20
});

test('array reordenado → resuelve al índice NUEVO (no al viejo)', () => {
  // Mueve AQUATECH4 del índice 9 al 2; el resto de posiciones deja de importar.
  const reordered = ['http://opcfoundation.org/UA/', 'urn:x', 'AQUATECH4', 'urn:y', 'urn:z'];
  const resolved = resolveNamespaces(reordered, mapping);
  assert.equal(resolved.get('AQUATECH4'), 2);
  assert.notEqual(resolved.get('AQUATECH4'), 9);
});

test('array sin AQUATECH4 → lanza NamespaceNotFoundError, NO devuelve 0', () => {
  const withoutAqua = ['http://opcfoundation.org/UA/', 'urn:FTOptix:Core', 'urn:otra'];
  assert.throws(
    () => resolveNamespaces(withoutAqua, mapping),
    (err: unknown) => {
      assert.ok(err instanceof NamespaceNotFoundError);
      assert.deepEqual((err as NamespaceNotFoundError).missing, ['AQUATECH4']);
      return true;
    },
  );
});

test('"aquatech" en minúsculas → NO hace match (case-sensitive)', () => {
  const lower = ['http://opcfoundation.org/UA/', 'aquatech'];
  assert.throws(() => resolveNamespaces(lower, mapping), NamespaceNotFoundError);
});
