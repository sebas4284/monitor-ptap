import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FAQ, buscarFaq } from './faq';

test('Ayuda cubre todos los códigos del catálogo vigente, sin entradas huérfanas', () => {
  const catalogo = readFileSync(
    new URL('../../../docs/CATALOGO_ERRORES.md', import.meta.url),
    'utf8',
  );
  const codigos = [...new Set(catalogo.match(/\b[A-Z]{3}-\d{2}\b/g))].sort();
  assert.ok(codigos.length > 0, 'El catálogo debe contener códigos');
  assert.deepEqual(Object.keys(FAQ).sort(), codigos);
  for (const [codigo, entry] of Object.entries(FAQ)) {
    for (const field of ['titulo', 'queEs', 'herramienta', 'queLeer'] as const) {
      assert.ok(entry[field].trim().length > 10, `${codigo}: falta ${field}`);
    }
  }
});

test('Ayuda busca por código o contenido y contempla consultas sin resultados', () => {
  assert.deepEqual(
    buscarFaq('  net-02  ').map(([codigo]) => codigo),
    ['NET-02'],
  );
  assert.ok(buscarFaq('sin conexión').some(([codigo]) => codigo === 'PLC-01'));
  assert.ok(buscarFaq('read-back').some(([codigo]) => codigo === 'CMD-07'));
  assert.equal(buscarFaq('problema-inexistente-xyz').length, 0);
  assert.equal(buscarFaq('   ').length, Object.keys(FAQ).length);
});
