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

test('el mapping real usa únicamente el nsUri AQUATECH', () => {
  assert.deepEqual(collectNsUris(mapping), ['AQUATECH']);
});

test('resuelve AQUATECH a su índice con el NamespaceArray real', () => {
  const resolved = resolveNamespaces(REAL_NS, mapping);
  assert.equal(resolved.get('AQUATECH'), REAL_NS.indexOf('AQUATECH'));
  assert.equal(resolved.get('AQUATECH'), 9); // índice observado en la captura
});

test('array reordenado → resuelve al índice NUEVO (no al viejo)', () => {
  // Mueve AQUATECH del índice 9 al 2; el resto de posiciones deja de importar.
  const reordered = ['http://opcfoundation.org/UA/', 'urn:x', 'AQUATECH', 'urn:y', 'urn:z'];
  const resolved = resolveNamespaces(reordered, mapping);
  assert.equal(resolved.get('AQUATECH'), 2);
  assert.notEqual(resolved.get('AQUATECH'), 9);
});

test('array sin AQUATECH → lanza NamespaceNotFoundError, NO devuelve 0', () => {
  const withoutAqua = ['http://opcfoundation.org/UA/', 'urn:FTOptix:Core', 'urn:otra'];
  assert.throws(
    () => resolveNamespaces(withoutAqua, mapping),
    (err: unknown) => {
      assert.ok(err instanceof NamespaceNotFoundError);
      assert.deepEqual((err as NamespaceNotFoundError).missing, ['AQUATECH']);
      return true;
    },
  );
});

test('"aquatech" en minúsculas → NO hace match (case-sensitive)', () => {
  const lower = ['http://opcfoundation.org/UA/', 'aquatech'];
  assert.throws(() => resolveNamespaces(lower, mapping), NamespaceNotFoundError);
});
