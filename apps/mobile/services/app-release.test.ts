/**
 * Detección de "hay una versión nueva".
 *
 * Contexto: la APK se reparte por descarga directa, sin tienda ni `expo-updates`, así que nadie se
 * entera de que salió una versión. El 2026-08-15 se descubrió que la APK servida llevaba días por
 * detrás del backend, con una pestaña que llamaba a un endpoint ya retirado, y no había forma de
 * avisar a quien la tuviera instalada.
 *
 * La comparación va por **versionCode**, no por el semver: es el entero que Android usa para
 * decidir si una instalación es más vieja, y no depende de que nadie interprete bien si "1.10.0"
 * va después de "1.9.0".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hayActualizacion, tamanoLegible, type AppRelease } from './app-release-compare';

function release(over: Partial<AppRelease> = {}): AppRelease {
  return {
    version: '1.1.0',
    versionCode: 2,
    publishedAt: '2026-08-15T12:00:00.000Z',
    sizeBytes: 35_503_027,
    downloadUrl: 'https://aquora.xpertic.co/descargar/',
    notes: null,
    ...over,
  };
}

test('versión: publicada más nueva que la instalada → hay actualización', () => {
  assert.equal(hayActualizacion(release({ versionCode: 3 }), 2), true);
});

test('versión: la misma no es actualización', () => {
  assert.equal(hayActualizacion(release({ versionCode: 2 }), 2), false);
});

test('versión: una publicada MÁS VIEJA no se anuncia como actualización', () => {
  // Pasa al revertir una APK: el servidor sirve la anterior y el usuario tiene la nueva. Decirle
  // "actualiza" lo mandaría a instalar hacia atrás.
  assert.equal(hayActualizacion(release({ versionCode: 1 }), 2), false);
});

// Sin certeza NO se molesta a nadie: un aviso de actualización que no existe erosiona la confianza
// en todos los demás avisos de la app.
test('versión: sin dato publicado no se afirma nada', () => {
  assert.equal(hayActualizacion(null, 2), false);
  assert.equal(hayActualizacion(release({ versionCode: null }), 2), false);
});

test('versión: sin saber la versión instalada tampoco (es el caso de la WEB)', () => {
  // En web `runningVersionCode()` devuelve null: no hay nada que actualizar a mano, la web se
  // sirve siempre fresca del servidor.
  assert.equal(hayActualizacion(release({ versionCode: 99 }), null), false);
});

test('versión: el salto de varias versiones se detecta igual', () => {
  assert.equal(hayActualizacion(release({ versionCode: 12 }), 2), true);
});

test('tamaño: se muestra en MB para no mandar a nadie a una descarga grande a ciegas', () => {
  assert.equal(tamanoLegible(35_503_027), '34 MB');
  assert.equal(tamanoLegible(null), null);
  assert.equal(tamanoLegible(0), null);
});
