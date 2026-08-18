/**
 * Qué versión de la APK está publicada.
 *
 * La regla que fija este test: **la fuente de verdad es el archivo publicado, no el repositorio.**
 * Durante semanas el repo fue por delante de lo instalado (2026-08-15: se servía una APK del 11-ago,
 * dos commits de `apps/mobile/` por detrás) y nadie se enteraba porque nada comparaba una cosa con
 * la otra. Leer la versión de `app.json` heredaría ese engaño con otra cara: diría "1.1.0" mientras
 * sirve un archivo que es 1.0.0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppReleaseService } from '../src/modules/app-release/app-release.service';

/** Directorio de publicación de mentira, con el contenido que se le indique. */
function conPublicacion(archivos: { apk?: boolean; meta?: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'ptap-apk-'));
  if (archivos.apk) writeFileSync(join(dir, 'monitor-ptap.apk'), Buffer.alloc(1024));
  if (archivos.meta !== undefined) writeFileSync(join(dir, 'version.json'), archivos.meta);
  process.env.APK_PUBLISH_DIR = dir;
  process.env.APP_PUBLIC_URL = 'https://aquora.xpertic.co';
  return { dir, limpiar: () => rmSync(dir, { recursive: true, force: true }) };
}

test('release: lee la versión del metadato publicado JUNTO al APK', () => {
  const { limpiar } = conPublicacion({
    apk: true,
    meta: JSON.stringify({ version: '1.1.0', versionCode: 2, notes: 'Arregla la pestaña HMI' }),
  });
  try {
    const r = new AppReleaseService().get();
    assert.equal(r.version, '1.1.0');
    assert.equal(r.versionCode, 2);
    assert.equal(r.notes, 'Arregla la pestaña HMI');
    assert.equal(r.sizeBytes, 1024, 'el tamaño sale del archivo real, no del metadato');
    assert.ok(r.publishedAt, 'la fecha sale del mtime del APK que de verdad se sirve');
    assert.equal(r.downloadUrl, 'https://aquora.xpertic.co/descargar/');
  } finally {
    limpiar();
  }
});

test('release: con APK pero SIN metadato no se inventa una versión', () => {
  // Es el estado real de producción hoy: hay APK del 11-ago y ningún version.json. Decir una
  // versión aquí haría que la app anunciara actualizaciones falsas.
  const { limpiar } = conPublicacion({ apk: true });
  try {
    const r = new AppReleaseService().get();
    assert.equal(r.version, null);
    assert.equal(r.versionCode, null);
    assert.ok(r.sizeBytes, 'pero el enlace y el tamaño sí se pueden ofrecer');
    assert.equal(r.downloadUrl, 'https://aquora.xpertic.co/descargar/');
  } finally {
    limpiar();
  }
});

test('release: sin APK publicada se devuelve el enlace y nada más', () => {
  const { limpiar } = conPublicacion({});
  try {
    const r = new AppReleaseService().get();
    assert.equal(r.version, null);
    assert.equal(r.sizeBytes, null);
    assert.equal(r.publishedAt, null);
  } finally {
    limpiar();
  }
});

test('release: un metadato corrupto no tumba el endpoint', () => {
  const { limpiar } = conPublicacion({ apk: true, meta: '{ esto no es json' });
  try {
    const r = new AppReleaseService().get();
    assert.equal(r.version, null, 'se degrada a "no sé", no a una excepción');
  } finally {
    limpiar();
  }
});

test('release: un versionCode que no sea número se descarta', () => {
  // Un "2" como texto nunca compararía bien contra el entero del dispositivo.
  const { limpiar } = conPublicacion({ apk: true, meta: JSON.stringify({ version: '1.1.0', versionCode: '2' }) });
  try {
    const r = new AppReleaseService().get();
    assert.equal(r.version, '1.1.0');
    assert.equal(r.versionCode, null);
  } finally {
    limpiar();
  }
});
