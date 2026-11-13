#!/usr/bin/env node
'use strict';
// Operational activation ONLY when invoked explicitly. plan is read-only; importing is inert.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const HOME = '/home/xpertic_app';
const PRODUCTION = `${HOME}/monitor-ptap`;
const PRIVATE = `${HOME}/.config/aquora-push`;
const PUBLIC_WEB = '/var/www/ptap-web';
const NODE = `${HOME}/.local/node-v26.12.1/bin/node`;
const ARCHIVE = 'e2cf4d4ee164f0660bbb8f61ce82a29d1f026d264a738c0c5b0fd656425b1907';
const MIGRATION = '0016_web_push_subscription.sql';
const MIGRATION_HASH = 'd1085cd96a418119e5f006449280bdca0292ba7fc58b739ca142e2c450d1c01f';
const PUSH_KEYS = ['FIREBASE_SERVICE_ACCOUNT_PATH', 'WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_VAPID_SUBJECT'];
const assert = (condition, message) => { if (!condition) throw Object.assign(new Error(message), { safeToPrint: true }); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const writePrivate = (file, value) => fs.writeFileSync(file, value, { mode: 0o600, flag: 'wx' });
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
let phase = 'validation';

function privateFile(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && stat.size < 1024 * 1024, 'Archivo privado inválido.');
  return fs.readFileSync(file);
}

function validatePushValues(push) {
  assert(Object.keys(push).length === PUSH_KEYS.length && Object.keys(push).every(key => PUSH_KEYS.includes(key)), 'push.env requiere exclusivamente las cuatro claves autorizadas.');
  assert(PUSH_KEYS.every(key => typeof push[key] === 'string' && push[key]), 'Configuración push incompleta.');
  const account = push.FIREBASE_SERVICE_ACCOUNT_PATH;
  assert(path.posix.dirname(account) === PRIVATE && path.posix.basename(account).endsWith('.json'), 'La cuenta FCM debe permanecer en el directorio privado autorizado.');
  const pair = crypto.createECDH('prime256v1');
  pair.setPrivateKey(Buffer.from(push.WEB_PUSH_VAPID_PRIVATE_KEY, 'base64url'));
  assert(pair.getPublicKey().toString('base64url') === push.WEB_PUSH_VAPID_PUBLIC_KEY, 'Par VAPID inválido.');
  assert(/^mailto:[^\s@]+@[^\s@]+$/.test(push.WEB_PUSH_VAPID_SUBJECT) || /^https:\/\/[^\s]+$/.test(push.WEB_PUSH_VAPID_SUBJECT), 'Subject VAPID inválido.');
  return push;
}

function runtimeEnv(previous, base, push) {
  return { ...previous, ...base, ...validatePushValues(push) };
}

function validateStage(stage) {
  assert(process.platform === 'linux' && process.getuid() !== 0, 'Ejecutar en la VM sin root.');
  stage = fs.realpathSync(stage);
  assert(path.dirname(stage) === `${HOME}/android-build/releases` && path.basename(stage).startsWith('release-e2cf4d4ee164-'), 'Release fuera del alcance autorizado.');
  assert(fs.statSync(stage).uid === process.getuid() && (fs.statSync(stage).mode & 0o077) === 0, 'Release no privada.');
  const receipt = json(path.join(stage, '.ptap-release.json'));
  assert(receipt.archiveSha256 === ARCHIVE && fileHash(path.join(stage, 'package-lock.json')) === receipt.lockSha256, 'Recibo de release o lockfile no coincide.');
  assert(!fs.existsSync(path.join(stage, '.env')), 'Mantener la release libre de .env para el build APK.');
  assert(fs.realpathSync(path.join(stage, 'node_modules')).startsWith(`${stage}/`), 'No enlazar dependencias de producción.');
  for (const file of ['apps/api/dist/main.js', 'packages/shared/dist/index.js', 'apps/mobile/dist/index.html', 'apps/mobile/dist/aquora-push-sw.js']) {
    assert(fs.lstatSync(path.join(stage, file)).isFile(), 'Falta un artefacto construido.');
  }
  return stage;
}

function loadSecrets(stage) {
  const requireStage = createRequire(path.join(stage, 'package.json'));
  const dotenv = requireStage('dotenv');
  const base = dotenv.parse(privateFile(`${PRODUCTION}/.env`));
  const push = validatePushValues(dotenv.parse(privateFile(`${PRIVATE}/push.env`)));
  const account = JSON.parse(privateFile(push.FIREBASE_SERVICE_ACCOUNT_PATH).toString('utf8'));
  assert(account.type === 'service_account' && account.project_id === 'desarrollo-1b2ba' && typeof account.client_email === 'string', 'Cuenta FCM/proyecto inválidos.');
  crypto.createPrivateKey(account.private_key);
  return { base, push, requireStage };
}

/** PM2 sees paths, never push secrets. cwd remains production/apps/api for PKI/reports/mapping. */
function boot(stage) {
  try {
    const { base, push } = loadSecrets(stage);
    Object.assign(process.env, runtimeEnv(process.env, base, push));
  } catch {
    // JSON/crypto parser diagnostics must never put a private-key fragment in PM2 logs.
    throw new Error('Configuración privada push inválida; inicio cancelado sin mostrar datos.');
  }
  require(path.join(stage, 'apps/api/dist/main.js'));
}

function pm2(args) {
  assert(fs.existsSync(`${HOME}/.pm2/rpc.sock`), 'Daemon PM2 existente requerido.');
  return execFileSync('/usr/bin/pm2', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { HOME, PM2_HOME: `${HOME}/.pm2`, PATH: `${path.dirname(NODE)}:/usr/local/bin:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'pipe'] });
}

function currentApp() {
  const apps = JSON.parse(pm2(['jlist'])).filter(app => app.name === 'ptap-api');
  assert(apps.length === 1, 'Se requiere exactamente una API en PM2.');
  return apps[0];
}

function checkPublisher() {
  const file = '/usr/local/sbin/ptap-web-publish', stat = fs.lstatSync(file);
  assert(stat.isFile() && stat.uid === 0 && (stat.mode & 0o022) === 0 && fileHash(file) === '852871a61b3303563d076d8cf120e4f430a8544fe42a7feb2cd96508408dbc78', 'Publicador root distinto del revisado.');
  execFileSync('/usr/bin/sudo', ['-n', '-l', file], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function appConfig(app, script) {
  const env = { ...(app.pm2_env.env || {}) };
  PUSH_KEYS.forEach(key => { delete env[key]; });
  return { apps: [{ name: 'ptap-api', script, cwd: `${PRODUCTION}/apps/api`, interpreter: NODE,
    exec_mode: 'fork', instances: 1, autorestart: app.pm2_env.autorestart ?? true,
    max_restarts: app.pm2_env.max_restarts ?? 10, max_memory_restart: app.pm2_env.max_memory_restart ?? '600M',
    kill_timeout: app.pm2_env.kill_timeout ?? 10000, time: true, env }] };
}

function treeFiles(directory, prefix = '') {
  assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Árbol web inválido.');
  const files = [];
  for (const entry of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, entry), relative = prefix + entry, stat = fs.lstatSync(full);
    if (stat.isDirectory()) files.push(...treeFiles(full, `${relative}/`));
    else { assert(stat.isFile(), 'El árbol web contiene enlaces/objetos especiales.'); files.push([relative, fileHash(full)]); }
  }
  return files;
}
const treeHash = directory => hash(JSON.stringify(treeFiles(directory)));

function copyTree(source, destination) {
  treeFiles(source);
  assert(!fs.existsSync(destination), 'Destino de respaldo ya existente.');
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, dereference: false });
  assert(treeHash(source) === treeHash(destination), 'Respaldo/copia web no coincide.');
}

async function database(stage, env, action) {
  const requireStage = createRequire(path.join(stage, 'package.json'));
  assert(['127.0.0.1', 'localhost'].includes(env.DB_HOST || '127.0.0.1') && env.DB_NAME && env.DB_PASSWORD && env.DB_USER, 'Sólo BD local configurada explícitamente.');
  const connection = await requireStage('mysql2/promise').createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, multipleStatements: false });
  try { return await action(connection); } finally { await connection.end(); }
}

async function migrationState(connection) {
  const [rows] = await connection.query('SELECT filename FROM schema_migrations ORDER BY filename');
  const [tables] = await connection.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', ['web_push_subscription']);
  return { applied: rows.map(row => row.filename), tableExists: Number(tables[0].count) === 1 };
}

async function migrateOnly0016(stage, env) {
  const directory = path.join(stage, 'apps/api/src/infrastructure/database/migrations');
  const sql = fs.readFileSync(path.join(directory, MIGRATION), 'utf8').replace(/\r\n/g, '\n');
  assert(hash(sql) === MIGRATION_HASH, 'La única migración autorizada cambió.');
  const required = fs.readdirSync(directory).filter(name => /^00(?:0\d|1[0-5])_.*\.sql$/.test(name));
  return database(stage, env, connection => applyOnly0016(connection, sql, required));
}

async function applyOnly0016(connection, sql, required) {
    assert(hash(sql) === MIGRATION_HASH, 'La única migración autorizada cambió.');
    const [lock] = await connection.query('SELECT GET_LOCK(?, 5) AS acquired', ['aquora-push-0016']);
    assert(Number(lock[0].acquired) === 1, 'Otra operación de migración está activa.');
    try {
      const before = await migrationState(connection);
      assert(required.length === 15 && required.every(name => before.applied.includes(name)), 'Las migraciones anteriores requieren revisión; no ejecutarlas aquí.');
      if (before.applied.includes(MIGRATION)) { assert(before.tableExists, 'Marcador0016 sin tabla.'); return { alreadyApplied: true }; }
      assert(!before.tableExists, 'Tabla0016 existente sin marcador: revisar DDL parcial antes de continuar.');
      // CREATE TABLE commits implicitly in MySQL. Application rollback deliberately retains it.
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [MIGRATION]);
      return { alreadyApplied: false };
    } finally { await connection.query('SELECT RELEASE_LOCK(?)', ['aquora-push-0016']); }
}

async function health(maxWaitMs = 180000) {
  const deadline = Date.now() + maxWaitMs;
  let statuses;
  do {
    let okay = true;
    statuses = {};
    for (const endpoint of ['health', 'health/db', 'health/opc']) {
      try { const response = await fetch(`http://127.0.0.1:4000/api/${endpoint}`, { signal: AbortSignal.timeout(10000) }); statuses[endpoint] = response.status; await response.body?.cancel(); okay &&= response.status === 200; }
      catch { statuses[endpoint] = 'timeout-or-network'; okay = false; }
    }
    if (okay) return true;
    if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 3000));
  } while (Date.now() < deadline);
  assert(false, `La salud API/BD/OPC no volvió a200 dentro de ${maxWaitMs}ms: ${JSON.stringify(statuses)}.`);
}

function savePm2() {
  pm2(['save']);
  for (const file of [`${HOME}/.pm2/dump.pm2`, `${HOME}/.pm2/dump.pm2.bak`]) {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  }
}

function switchApi(configuration) {
  if (JSON.parse(pm2(['jlist'])).some(app => app.name === 'ptap-api')) pm2(['delete', 'ptap-api']);
  // No concurrent OPC process; private wrapper loads env after PM2 launches it.
  pm2(['start', configuration, '--only', 'ptap-api']);
}

function publishWeb(source, activation, label) {
  assert(treeFiles(source).some(([name]) => name === 'index.html'), 'Bundle web sin index.');
  const input = `${PRODUCTION}/apps/mobile/dist`;
  const preserved = path.join(activation, `publisher-input-${label}`);
  const replacement = path.join(activation, `publisher-copy-${label}`);
  copyTree(source, replacement);
  assert(fs.lstatSync(input).isDirectory() && !fs.lstatSync(input).isSymbolicLink(), 'Entrada del publicador inválida.');
  fs.renameSync(input, preserved);
  try {
    fs.renameSync(replacement, input);
    execFileSync('/usr/bin/sudo', ['-n', '/usr/local/sbin/ptap-web-publish'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
    assert(treeHash(source) === treeHash(PUBLIC_WEB), 'La publicación web no coincide con el bundle.');
  } finally {
    // Restore original generated dist even when root publishing fails. Never alter source files.
    if (fs.existsSync(input)) fs.renameSync(input, replacement);
    fs.renameSync(preserved, input);
  }
}

async function publicHealth(stage) {
  for (const route of ['/api/health', '/']) {
    const response = await fetch(`https://aquora.xpertic.co${route}`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    assert(response.status === 200, 'Salud HTTPS fallida.'); await response.body?.cancel();
  }
  const worker = await fetch('https://aquora.xpertic.co/aquora-push-sw.js', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
  assert(worker.status === 200 && hash(Buffer.from(await worker.arrayBuffer())) === fileHash(path.join(stage, 'apps/mobile/dist/aquora-push-sw.js')), 'Service worker público no coincide.');
}

function activationPath(stage) { return path.join(PRIVATE, `activation-${path.basename(stage)}`); }
function stateWrite(activation, state) {
  fs.writeFileSync(path.join(activation, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function rollback(stage, activation, state) {
  const live = JSON.parse(pm2(['jlist'])).filter(app => app.name === 'ptap-api');
  assert(live.length <= 1 && live.every(app => [state.beforeScript, path.join(activation, 'runtime.cjs')].includes(app.pm2_env.pm_exec_path)), 'El proceso cambió fuera de esta activación.');
  if (state.status === 'rolled-back') {
    await health();
    assert(treeHash(PUBLIC_WEB) === state.beforeWebHash, 'La web cambió después del rollback.');
    return;
  }
  state.status = 'rollback-started'; stateWrite(activation, state);
  try {
    phase = 'rollback-api';
    switchApi(path.join(activation, 'previous.config.json'));
    await health();
    if (state.webAttempted) {
      phase = 'rollback-web';
      publishWeb(path.join(activation, 'web-before'), activation, `rollback-${Date.now()}`);
    }
    savePm2();
    state.status = 'rolled-back'; state.rolledBackAt = new Date().toISOString(); stateWrite(activation, state);
    console.log(JSON.stringify({ status: 'rolled-back', migration0016Retained: true }));
  } catch (error) {
    state.status = 'rollback-failed'; state.rollbackFailedPhase = phase; stateWrite(activation, state);
    throw error;
  }
}

async function plan(stage) {
  stage = validateStage(stage);
  checkPublisher();
  const app = currentApp();
  const { base, push } = loadSecrets(stage);
  const migration = await database(stage, runtimeEnv({}, base, push), async connection => {
    await connection.query('SET SESSION TRANSACTION READ ONLY'); await connection.beginTransaction();
    try { return await migrationState(connection); } finally { await connection.rollback(); }
  });
  console.log(JSON.stringify({ stage, archive: ARCHIVE, apiStatus: app.pm2_env.status,
    currentScript: app.pm2_env.pm_exec_path, preservedCwd: `${PRODUCTION}/apps/api`,
    pushValidated: true, migration0016Applied: migration.applied.includes(MIGRATION), tableExists: migration.tableExists,
    sourceWebHash: treeHash(path.join(stage, 'apps/mobile/dist')), publishedWebHash: treeHash(PUBLIC_WEB) }));
}

async function activate(stage) {
  phase = 'validate-stage';
  stage = validateStage(stage);
  phase = 'publisher-policy';
  checkPublisher();
  phase = 'pm2-snapshot';
  const app = currentApp();
  assert(app.pm2_env.pm_exec_path === `${PRODUCTION}/apps/api/dist/main.js` && app.pm2_env.pm_cwd === `${PRODUCTION}/apps/api` && app.pm2_env.status === 'online', 'Proceso inicial distinto del revisado.');
  phase = 'private-configuration';
  const { base, push } = loadSecrets(stage);
  phase = 'preflight-health';
  await health(60000);
  phase = 'prepare-private-backups';
  const activation = activationPath(stage);
  fs.mkdirSync(activation, { mode: 0o700 });
  const stableHelper = path.join(activation, 'runtime-helper.cjs');
  fs.copyFileSync(__filename, stableHelper); fs.chmodSync(stableHelper, 0o600);
  const wrapper = path.join(activation, 'runtime.cjs');
  writePrivate(wrapper, `'use strict';\nrequire(${JSON.stringify(stableHelper)}).boot(${JSON.stringify(stage)});\n`);
  writePrivate(path.join(activation, 'previous.config.json'), JSON.stringify(appConfig(app, app.pm2_env.pm_exec_path), null, 2));
  writePrivate(path.join(activation, 'previous.pm2.json'), JSON.stringify(app, null, 2));
  writePrivate(path.join(activation, 'next.config.json'), JSON.stringify(appConfig(app, wrapper), null, 2));
  copyTree(PUBLIC_WEB, path.join(activation, 'web-before'));
  const state = { status: 'prepared', stage, archive: ARCHIVE, beforeScript: app.pm2_env.pm_exec_path,
    beforeWebHash: treeHash(PUBLIC_WEB), afterWebHash: treeHash(path.join(stage, 'apps/mobile/dist')), webAttempted: false, apiAttempted: false };
  stateWrite(activation, state);
  try {
    phase = 'migration0016';
    await migrateOnly0016(stage, runtimeEnv({}, base, push));
    state.status = 'migrated'; stateWrite(activation, state);
    phase = 'api-switch';
    state.apiAttempted = true; stateWrite(activation, state);
    switchApi(path.join(activation, 'next.config.json'));
    await health();
    phase = 'web-publish';
    state.webAttempted = true; stateWrite(activation, state);
    publishWeb(path.join(stage, 'apps/mobile/dist'), activation, 'activate');
    await publicHealth(stage);
    savePm2();
    state.status = 'active'; state.activatedAt = new Date().toISOString(); stateWrite(activation, state);
    console.log(JSON.stringify({ status: 'active', stage, apiHealth: true, webVerified: true, pushReceptionTestPending: true }));
  } catch (error) {
    state.failedPhase = phase; stateWrite(activation, state);
    if (state.apiAttempted) await rollback(stage, activation, state);
    throw error;
  }
}

module.exports = { validatePushValues, runtimeEnv, treeHash, applyOnly0016, boot, health };
if (require.main === module) {
  const [mode, input, ...extra] = process.argv.slice(2);
  (async () => {
    process.umask(0o077);
    assert(extra.length === 0 && input && ['plan', 'activate', 'rollback'].includes(mode), 'Uso: plan|activate|rollback <release>.');
    if (mode === 'plan') return plan(input);
    const stage = validateStage(input);
    const directory = fs.lstatSync(PRIVATE);
    assert(directory.isDirectory() && directory.uid === process.getuid() && (directory.mode & 0o077) === 0, 'Directorio privado inválido.');
    const lock = path.join(PRIVATE, '.activation.lock');
    const handle = fs.openSync(lock, 'wx', 0o600);
    try {
      fs.writeFileSync(handle, String(process.pid));
      if (mode === 'activate') await activate(stage);
      else { const activation = activationPath(stage); await rollback(stage, activation, json(path.join(activation, 'state.json'))); }
    } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
  })().catch(error => { console.error(`Activación no completada; fase=${phase}. ${error.safeToPrint ? error.message : 'Detalles privados omitidos.'} Revisar estado/rollback antes de reintentar.`); process.exitCode = 1; });
}
