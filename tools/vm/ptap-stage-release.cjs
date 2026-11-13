#!/usr/bin/env node
'use strict';
// Prepares a NEW private release only. Never migrates, starts the API, publishes, or restarts services.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { firebaseMatches } = require('./ptap-android-release-preflight.cjs');

const PRODUCTION = '/home/xpertic_app/monitor-ptap';
const BUILD = '/home/xpertic_app/android-build';
const RELEASES = `${BUILD}/releases`;
const PROJECT = 'desarrollo-1b2ba';
const GRADLE_SHA = '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb';
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const json = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('JSON ausente o inválido; contenido omitido.'); } };
const capture = (command, args, cwd, env = process.env) => execFileSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

function sourcePath(file) {
  const slashPath = file.replace(/\\/g, '/');
  const parts = slashPath.split('/');
  const normalized = path.posix.normalize(slashPath).replace(/^(?:\.\/)+/, '');
  return Boolean(slashPath) && normalized !== '.' && !path.posix.isAbsolute(slashPath) && !/^[A-Za-z]:/.test(slashPath) &&
    !/[\r\n\0]/.test(slashPath) && !parts.includes('..') &&
    !parts.some(part => ['.git', 'node_modules', '.expo'].includes(part) || (part.startsWith('.env') && part !== '.env.example')) &&
    !/^(?:apps\/mobile\/)?(?:android|ios)(?:\/|$)/.test(normalized) &&
    !/(?:^|\/)(?:google-services\.json|[^/]*\.(?:pem|key|keystore|jks|p12|p8))$/i.test(normalized);
}

function boundedFile(file, expectedHash, maxBytes) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && stat.size > 0 && stat.size <= maxBytes, 'Se requiere un archivo regular acotado, sin enlaces.');
  assert(/^[a-f0-9]{64}$/.test(expectedHash) && sha256(file) === expectedHash, 'SHA256 no coincide; operación detenida.');
}

function validateArchiveListing(entries, details) {
  assert(details.length === entries.length && details.every(line => /^[-d]/.test(line)), 'El archivo contiene enlaces u objetos especiales.');
  assert(entries.length > 0 && entries.every((entry, index) => entry === './' ? details[index].startsWith('d') : sourcePath(entry)), 'El archivo contiene rutas excluidas.');
}

function prepare(archive, archiveHash, googleFile, googleHash) {
  assert(process.platform === 'linux', 'La preparación se ejecuta en la VM Linux.');
  assert(process.getuid() !== 0, 'Staging y compilación deben ejecutarse sin root.');
  boundedFile(archive, archiveHash, 256 * 1024 * 1024);
  boundedFile(googleFile, googleHash, 1024 * 1024);
  const firebase = json(googleFile);
  assert(firebase.type !== 'service_account' && !firebase.private_key, 'Sólo configuración pública Android, nunca una cuenta de servicio.');
  firebaseMatches(firebase, 'com.ptap.monitor', PROJECT);
  const entries = capture('/usr/bin/tar', ['-tf', path.resolve(archive)]).split('\n').filter(Boolean);
  const details = capture('/usr/bin/tar', ['-tvf', path.resolve(archive)]).split('\n').filter(Boolean);
  validateArchiveListing(entries, details);
  assert(fs.realpathSync(BUILD) === BUILD, 'El directorio de build no puede ser un enlace.');
  if (!fs.existsSync(RELEASES)) fs.mkdirSync(RELEASES, { mode: 0o700 });
  const base = fs.lstatSync(RELEASES);
  assert(base.isDirectory() && base.uid === process.getuid() && (base.mode & 0o077) === 0 && fs.realpathSync(RELEASES) === RELEASES, 'Releases debe ser un directorio privado real del usuario.');
  const stage = fs.mkdtempSync(`${RELEASES}/release-${archiveHash.slice(0, 12)}-`);
  fs.chmodSync(stage, 0o700);
  // New directory + inspected own Git archive: existing production and local changes are untouched.
  capture('/usr/bin/tar', ['--no-same-owner', '--no-same-permissions', '-xf', path.resolve(archive), '-C', stage]);
  capture('/usr/bin/git', ['init', '--quiet', stage]); // preflight's check-ignore needs repository metadata.
  const destination = path.join(stage, 'apps/mobile/google-services.json');
  fs.copyFileSync(googleFile, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
  assert(sha256(destination) === googleHash, 'La copia de Firebase no conserva su SHA256.');
  const receipt = { archiveSha256: archiveHash, firebaseSha256: googleHash, lockSha256: sha256(path.join(stage, 'package-lock.json')), project: PROJECT, preparedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(stage, '.ptap-release.json'), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
  return { stage, ...receipt };
}

function validateStage(stage) {
  assert(process.platform === 'linux', 'Ejecutar sólo en la VM Linux.');
  assert(process.getuid() !== 0, 'Staging y compilación deben ejecutarse sin root.');
  const resolved = fs.realpathSync(stage);
  assert(resolved === path.resolve(stage) && path.dirname(resolved) === RELEASES && path.basename(resolved).startsWith('release-'), 'La operación exige una release nueva privada, fuera de producción.');
  assert(fs.statSync(resolved).uid === process.getuid() && (fs.statSync(resolved).mode & 0o077) === 0, 'Release ajena o accesible a otros usuarios.');
  const receipt = json(path.join(resolved, '.ptap-release.json'));
  assert(receipt.project === PROJECT && sha256(path.join(resolved, 'package-lock.json')) === receipt.lockSha256, 'Cambió el lockfile o el proyecto; revisar nuevamente.');
  boundedFile(path.join(resolved, 'apps/mobile/google-services.json'), receipt.firebaseSha256, 1024 * 1024);
  const modules = path.join(resolved, 'node_modules');
  if (fs.existsSync(modules)) assert(fs.lstatSync(modules).isDirectory() && !fs.lstatSync(modules).isSymbolicLink(), 'node_modules debe pertenecer a la release; no enlazar producción.');
  assert(!fs.existsSync(path.join(resolved, '.env')), 'El build no admite secretos de producción ni un .env copiado.');
  return resolved;
}

function run(stage, command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: stage, stdio: 'inherit', env: {
    ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1',
    JAVA_HOME: `${BUILD}/jdk`, ANDROID_HOME: `${BUILD}/sdk`, GRADLE_USER_HOME: `${BUILD}/gradle-home`,
    PATH: `/home/xpertic_app/.local/node-v26.12.1/bin:${BUILD}/jdk/bin:${BUILD}/sdk/platform-tools:/usr/bin:/bin`, ...env,
  } });
  assert(!result.error && result.status === 0, 'Falló un paso de staging; conservar la release y su evidencia.');
}

function install(stage) {
  stage = validateStage(stage);
  run(stage, '/home/xpertic_app/.local/node-v26.12.1/bin/npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  validateStage(stage);
  // Fail rather than rebuilding native dependencies or running third-party lifecycle scripts silently.
  run(stage, process.execPath, ['-e', "require('argon2'); require('esbuild').transformSync('const x = 1'); require('web-push'); console.log('Dependencias nativas/Web Push disponibles sin lifecycle scripts.');"]);
}

function buildWebApi(stage) {
  stage = validateStage(stage);
  const tsc = path.join(stage, 'node_modules/typescript/bin/tsc');
  run(stage, process.execPath, [tsc, '-p', 'packages/shared/tsconfig.json']);
  run(stage, process.execPath, [tsc, '-p', 'apps/api/tsconfig.build.json']);
  run(path.join(stage, 'apps/mobile'), process.execPath, [path.join(stage, 'node_modules/expo/bin/cli'), 'export', '-p', 'web', '--clear'], {
    API_BASE_URL: '', GOOGLE_SERVICES_JSON: path.join(stage, 'apps/mobile/google-services.json'),
  });
}

function androidContext(stage) {
  stage = validateStage(stage);
  const mobile = path.join(stage, 'apps/mobile');
  const env = { API_BASE_URL: 'https://aquora.xpertic.co', PTAP_REQUIRE_FCM: '1', PTAP_FIREBASE_PROJECT_ID: PROJECT, GOOGLE_SERVICES_JSON: path.join(mobile, 'google-services.json') };
  firebaseMatches(json(env.GOOGLE_SERVICES_JSON), 'com.ptap.monitor', PROJECT);
  return { stage, mobile, env };
}

function buildAndroid(input) {
  const { stage, mobile, env } = androidContext(input);
  run(mobile, process.execPath, [path.join(stage, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install'], env);
  const preservedKey = `${PRODUCTION}/apps/mobile/android/app/debug.keystore`;
  assert(fs.lstatSync(preservedKey).isFile(), 'Falta la clave existente; no crear una firma sustituta.');
  const stagedKey = path.join(mobile, 'android/app/debug.keystore');
  fs.copyFileSync(preservedKey, stagedKey);
  fs.chmodSync(stagedKey, 0o600);
  assert(sha256(stagedKey) === sha256(preservedKey), 'La copia de la firma existente no coincide.');
  const wrapper = path.join(mobile, 'android/gradle/wrapper/gradle-wrapper.properties');
  let properties = fs.readFileSync(wrapper, 'utf8').replace(/^distributionUrl=.*$/m, 'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip');
  properties = properties.replace(/^distributionSha256Sum=.*\r?\n?/m, '');
  fs.writeFileSync(wrapper, `${properties.trim()}\ndistributionSha256Sum=${GRADLE_SHA}\n`);
  assembleAndroid(stage, mobile, env);
}

function resumeAndroid(input) {
  const { stage, mobile, env } = androidContext(input);
  // Preserve the already-generated native tree, signing key, wrapper and incremental outputs.
  assembleAndroid(stage, mobile, env);
}

function assembleAndroid(stage, mobile, env) {
  const preflight = path.join(stage, 'tools/vm/ptap-android-release-preflight.cjs');
  run(stage, process.execPath, [preflight], env);
  run(path.join(mobile, 'android'), `${BUILD}/gradle-9.4.1/bin/gradle`, ['assembleRelease', '--no-daemon', '--max-workers=1', '--console=plain', '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=768m -XX:+ExitOnOutOfMemoryError', '-Pkotlin.compiler.execution.strategy=in-process'], env);
  run(stage, process.execPath, [preflight, path.join(mobile, 'android/app/build/outputs/apk/release/app-release.apk')], env);
}

module.exports = { sourcePath, boundedFile, validateArchiveListing, resumeAndroid, assembleAndroid };
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    process.umask(0o077);
    if (mode === 'prepare' && args.length === 4) console.log(JSON.stringify(prepare(...args)));
    else if (mode === 'install' && args.length === 1) install(args[0]);
    else if (mode === 'build-web-api' && args.length === 1) buildWebApi(args[0]);
    else if (mode === 'build-android' && args.length === 1) buildAndroid(args[0]);
    else if (mode === 'resume-android' && args.length === 1) resumeAndroid(args[0]);
    else throw new Error('Uso: prepare <tar> <sha256> <google-services.json> <sha256> | install|build-web-api|build-android|resume-android <release>.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
