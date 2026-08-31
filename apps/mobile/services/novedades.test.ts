/**
 * La marca de «nuevo» de la pestaña de Novedades.
 *
 * Se prueba el módulo puro (`novedades-compare.ts`) y no `novedades.ts`, que importa AsyncStorage:
 * es la misma separación que hay entre `app-release-compare.ts` y `app-release.ts`, y por el mismo
 * motivo — un módulo nativo no se puede cargar en `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararVersiones, hayNovedadNueva, versionMasReciente } from './novedades-compare';

const entrada = (version: string) => ({ version, fecha: '2026-08-26', puntos: ['algo'] });

test('novedades: se comparan por número, no como texto', () => {
  // "1.10.0" < "1.9.0" en orden alfabético. Es el fallo clásico y el que dejaría la marca apagada
  // justo cuando hay versión nueva.
  assert.ok(compararVersiones('1.10.0', '1.9.0') > 0);
  assert.ok(compararVersiones('1.3.0', '1.3.0') === 0);
  assert.ok(compararVersiones('1.2.4', '1.3.0') < 0);
});

test('novedades: la más reciente no depende del orden en que lleguen', () => {
  assert.equal(versionMasReciente([entrada('1.2.4'), entrada('1.10.0'), entrada('1.9.0')]), '1.10.0');
  assert.equal(versionMasReciente([]), null);
});

test('novedades: nunca abierta la pestaña → hay novedad', () => {
  assert.equal(hayNovedadNueva([entrada('1.3.0')], null), true);
});

test('novedades: ya vista la más reciente → no hay novedad', () => {
  assert.equal(hayNovedadNueva([entrada('1.3.0'), entrada('1.2.4')], '1.3.0'), false);
});

test('novedades: publicada una posterior a la vista → hay novedad', () => {
  assert.equal(hayNovedadNueva([entrada('1.4.0'), entrada('1.3.0')], '1.3.0'), true);
});

test('novedades: vista una MÁS nueva que el listado → no hay novedad', () => {
  // Pasa al volver atrás en el servidor. Encender la marca aquí sería un aviso de algo que el
  // usuario ya leyó.
  assert.equal(hayNovedadNueva([entrada('1.3.0')], '1.4.0'), false);
});

test('novedades: listado vacío → no hay novedad y no lanza', () => {
  assert.equal(hayNovedadNueva([], null), false);
  assert.equal(hayNovedadNueva([], '1.3.0'), false);
});
