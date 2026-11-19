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
import {
  hayActualizacion,
  tamanoLegible,
  decidirAvisoActualizacion,
  type AppRelease,
} from './app-release-compare';

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

// ── Aviso en el panel del telefono ────────────────────────────────────────────────────────────
//
// Lo que protege: la tarea de fondo corre cada ~15 minutos. Sin recordar de que version ya se
// aviso, el panel del telefono se llenaria del mismo aviso indefinidamente. Es el mismo problema
// que `ptap_last_notified_id` resuelve para los avisos de planta.

test('aviso: version nueva y nunca avisada -> avisa, con la version en el titulo', () => {
  const a = decidirAvisoActualizacion(release({ version: '1.4.0', versionCode: 9 }), 8, null);
  assert.notEqual(a, null);
  assert.match(a!.titulo, /1\.4\.0/);
  assert.equal(a!.versionCode, 9);
  assert.match(a!.cuerpo, /Toca para descargarla/);
});

test('aviso: ya se aviso de ESA version -> no repite (esto evita el aviso cada 15 min)', () => {
  assert.equal(decidirAvisoActualizacion(release({ versionCode: 9 }), 8, 9), null);
});

test('aviso: se aviso de una POSTERIOR -> no repite', () => {
  assert.equal(decidirAvisoActualizacion(release({ versionCode: 9 }), 8, 10), null);
});

test('aviso: se aviso de una ANTERIOR -> vuelve a avisar de la nueva', () => {
  const a = decidirAvisoActualizacion(release({ versionCode: 10 }), 8, 9);
  assert.equal(a?.versionCode, 10);
});

test('aviso: la instalada ya esta al dia -> no avisa', () => {
  assert.equal(decidirAvisoActualizacion(release({ versionCode: 9 }), 9, null), null);
});

test('aviso: en web (versionCode instalado null) -> no avisa', () => {
  assert.equal(decidirAvisoActualizacion(release({ versionCode: 9 }), null, null), null);
});

test('aviso: el servidor no contesto (release null) -> no avisa y no lanza', () => {
  assert.equal(decidirAvisoActualizacion(null, 8, null), null);
});

test('aviso: sin versionCode publicado -> no avisa (sin certeza no se molesta a nadie)', () => {
  assert.equal(decidirAvisoActualizacion(release({ versionCode: null }), 8, null), null);
});

test('aviso: las notas del release van en el cuerpo, y el tamano en la llamada a la accion', () => {
  const a = decidirAvisoActualizacion(
    release({ versionCode: 9, notes: 'Vuelve el mando de valvulas.', sizeBytes: 35_587_387 }),
    8,
    null,
  );
  assert.match(a!.cuerpo, /Vuelve el mando de valvulas\./);
  assert.match(a!.cuerpo, /\(34 MB\)/);
});

test('aviso: sin notas ni tamano el cuerpo sigue siendo util', () => {
  const a = decidirAvisoActualizacion(release({ versionCode: 9, notes: null, sizeBytes: null }), 8, null);
  assert.equal(a!.cuerpo, '▸ Toca para descargarla e instalarla.');
});
