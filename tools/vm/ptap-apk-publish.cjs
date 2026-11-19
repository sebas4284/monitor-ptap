#!/usr/bin/env node
'use strict';
// Administrative publication only. No SDK execution, build, service changes, or secret reads.
// publish requires the SHA256 approved after build-android's successful FINAL preflight.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const STAGE = '/home/xpertic_app/android-build/releases/release-e2cf4d4ee164-CFMDWd';
const CANDIDATE = `${STAGE}/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`;
const DESTINATION = '/var/www/ptap-download';
const BACKUPS = '/var/backups/aquora-apk';
const PREVIOUS_APK_SHA = '4082213222c1fe131850c8bee30f1da88771e5843952ac401a7e4d380a4ff11a';
const CERTIFICATE = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';
const APK = 'monitor-ptap.apk', META = 'version.json';
const assert = (condition, message) => { if (!condition) throw Object.assign(new Error(message), { safeToPrint: true }); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const metadata = { version: '1.4.1', versionCode: 10,
  notes: 'Corrige el cierre de la aplicación al iniciar y actualiza su nombre a Aquora. Conserva los avisos de planta por push.' };

function readRegular(file, maximum) {
  assert(fs.realpathSync(file) === file, 'Se rechazan enlaces en la ruta del artefacto.');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    assert(stat.isFile() && stat.size > 0 && stat.size <= maximum, 'Archivo regular ausente o fuera de tamaño.');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assert(after.size === stat.size && after.mtimeMs === stat.mtimeMs && bytes.length === stat.size, 'El archivo cambió durante la lectura.');
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function trustedRootPath(file) {
  file = fs.realpathSync(file);
  for (let item = file; ; item = path.dirname(item)) {
    const stat = fs.lstatSync(item);
    assert(stat.uid === 0 && (stat.mode & 0o022) === 0, 'Helper/runtime y sus directorios deben ser root y no escribibles por otros.');
    if (item === '/') break;
  }
}

function prepareAdministrativeContext() {
  assert(process.platform === 'linux' && process.getuid() === 0, 'Este helper requiere una terminal administrativa Linux.');
  assert(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Ejecutar con NODE_OPTIONS/NODE_PATH eliminados.');
  trustedRootPath(__filename); trustedRootPath(process.execPath);
  assert(fs.realpathSync(DESTINATION) === DESTINATION, 'Destino público no real.');
  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { mode: 0o700 });
  trustedRootPath(BACKUPS);
  assert((fs.statSync(BACKUPS).mode & 0o077) === 0 && fs.statSync(BACKUPS).dev === fs.statSync(DESTINATION).dev, 'Backup privado y publicación deben estar en el mismo filesystem.');
}

function writePrivate(file, bytes) { fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' }); }
function receiptWrite(directory, value) {
  const temporary = path.join(directory, `receipt-${crypto.randomUUID()}.tmp`);
  writePrivate(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, path.join(directory, 'receipt.json'));
}

function preparedPublicFile(directory, name, bytes) {
  const file = path.join(directory, `${name}-${crypto.randomUUID()}.ready`);
  writePrivate(file, bytes);
  assert(sha(readRegular(file, 256 * 1024 * 1024)) === sha(bytes), 'La copia preparada no coincide.');
  fs.chownSync(file, 33, 33); fs.chmodSync(file, 0o644);
  // Its parent remains root0700 until rename: no public temporary or unverified secret exposure.
  return file;
}

function restore(directory, receipt) {
  const previousApk = readRegular(path.join(directory, 'before.apk'), 256 * 1024 * 1024);
  const previousMeta = readRegular(path.join(directory, 'before.json'), 64 * 1024);
  assert(sha(previousApk) === receipt.beforeApkSha256 && sha(previousMeta) === receipt.beforeMetadataSha256, 'Respaldo alterado; no revertir.');
  const currentApk = sha(readRegular(path.join(DESTINATION, APK), 256 * 1024 * 1024));
  const currentMeta = sha(readRegular(path.join(DESTINATION, META), 64 * 1024));
  assert([receipt.beforeApkSha256, receipt.afterApkSha256].includes(currentApk) && [receipt.beforeMetadataSha256, receipt.afterMetadataSha256].includes(currentMeta), 'Otra publicación cambió los archivos; revisar antes de revertir.');
  const oldMeta = preparedPublicFile(directory, 'metadata-rollback', previousMeta);
  const oldApk = preparedPublicFile(directory, 'apk-rollback', previousApk);
  fs.renameSync(oldMeta, path.join(DESTINATION, META));
  fs.renameSync(oldApk, path.join(DESTINATION, APK));
  assert(sha(readRegular(path.join(DESTINATION, APK), 256 * 1024 * 1024)) === receipt.beforeApkSha256 &&
    sha(readRegular(path.join(DESTINATION, META), 64 * 1024)) === receipt.beforeMetadataSha256, 'Reversión no coincide.');
  receipt.status = 'rolled-back'; receipt.rolledBackAt = new Date().toISOString(); receiptWrite(directory, receipt);
}

function publish(expectedSha256) {
  assert(/^[a-f0-9]{64}$/.test(expectedSha256), 'Falta el SHA256 exacto aprobado tras la preflight final0.');
  const candidate = readRegular(CANDIDATE, 256 * 1024 * 1024);
  assert(sha(candidate) === expectedSha256, 'APK candidata distinta de la aprobada.');
  const previousApk = readRegular(path.join(DESTINATION, APK), 256 * 1024 * 1024);
  const previousMeta = readRegular(path.join(DESTINATION, META), 64 * 1024);
  const old = JSON.parse(previousMeta.toString('utf8'));
  assert(sha(previousApk) === PREVIOUS_APK_SHA && old.version === '1.4.0' && old.versionCode === 9, 'La publicación anterior cambió; detenerse.');
  const nextMeta = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  const directory = fs.mkdtempSync(`${BACKUPS}/publication-`); fs.chmodSync(directory, 0o700);
  writePrivate(path.join(directory, 'before.apk'), previousApk);
  writePrivate(path.join(directory, 'before.json'), previousMeta);
  const receipt = { status: 'prepared', stage: STAGE, candidate: CANDIDATE,
    package: 'com.ptap.monitor', version: metadata.version, versionCode: metadata.versionCode,
    preflightEvidence: 'Exact candidate hash supplied by operator after existing final build preflight succeeded; this publisher does not rerun SDK validators.',
    expectedSignerSha256: CERTIFICATE, beforeApkSha256: sha(previousApk), beforeMetadataSha256: sha(previousMeta),
    afterApkSha256: expectedSha256, afterMetadataSha256: sha(nextMeta), sizeBytes: candidate.length, preparedAt: new Date().toISOString() };
  receiptWrite(directory, receipt);
  const nextApk = preparedPublicFile(directory, 'apk', candidate);
  const nextJson = preparedPublicFile(directory, 'metadata', nextMeta);
  assert(sha(readRegular(path.join(DESTINATION, APK), 256 * 1024 * 1024)) === receipt.beforeApkSha256 &&
    sha(readRegular(path.join(DESTINATION, META), 64 * 1024)) === receipt.beforeMetadataSha256, 'Los archivos publicados cambiaron antes del rename.');
  let changed = false;
  try {
    fs.renameSync(nextApk, path.join(DESTINATION, APK)); changed = true;
    fs.renameSync(nextJson, path.join(DESTINATION, META));
    assert(sha(readRegular(path.join(DESTINATION, APK), 256 * 1024 * 1024)) === expectedSha256 &&
      sha(readRegular(path.join(DESTINATION, META), 64 * 1024)) === receipt.afterMetadataSha256, 'Publicación no coincide.');
    receipt.status = 'published'; receipt.publishedAt = new Date().toISOString(); receiptWrite(directory, receipt);
    console.log(JSON.stringify({ status: 'published', version: metadata.version, versionCode: metadata.versionCode, sha256: expectedSha256, sizeBytes: candidate.length, rollbackDirectory: directory }));
  } catch (error) {
    receipt.status = 'failed';
    try { receiptWrite(directory, receipt); } catch { /* Still attempt artifact rollback if receipt storage fails. */ }
    if (changed) {
      try { restore(directory, receipt); }
      catch { receipt.status = 'rollback-failed'; try { receiptWrite(directory, receipt); } catch { /* Report directory below. */ } }
    }
    console.error(JSON.stringify({ status: receipt.status, rollbackDirectory: directory }));
    throw error;
  }
}

function rollback(directory) {
  directory = fs.realpathSync(directory);
  assert(path.dirname(directory) === BACKUPS && path.basename(directory).startsWith('publication-'), 'Directorio de reversión fuera de alcance.');
  trustedRootPath(directory);
  const receipt = JSON.parse(readRegular(path.join(directory, 'receipt.json'), 64 * 1024).toString('utf8'));
  assert(receipt.stage === STAGE && receipt.beforeApkSha256 === PREVIOUS_APK_SHA && receipt.version === '1.4.1' && receipt.versionCode === 10, 'Recibo fuera de esta publicación.');
  restore(directory, receipt);
  console.log(JSON.stringify({ status: 'rolled-back', version: '1.4.0', versionCode: 9, installedPhonesUnchanged: true }));
}

if (require.main === module) {
  try {
    process.umask(0o077);
    const [mode, argument, ...extra] = process.argv.slice(2);
    assert(extra.length === 0 && argument && ['publish', 'rollback'].includes(mode), 'Uso: publish <sha256-aprobado> | rollback <directorio-del-recibo>.');
    prepareAdministrativeContext();
    const lock = path.join(BACKUPS, '.publish.lock');
    const descriptor = fs.openSync(lock, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, String(process.pid)); mode === 'publish' ? publish(argument) : rollback(argument); }
    finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  } catch (error) { console.error(error.safeToPrint ? error.message : 'Publicación no completada; conservar respaldo/recibo y revisar sin exponer datos.'); process.exitCode = 1; }
}
