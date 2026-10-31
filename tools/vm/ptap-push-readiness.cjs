#!/usr/bin/env node
'use strict';
// Host-local read-only readiness. Never requests Google auth or sends a notification.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const KEY = 'FIREBASE_SERVICE_ACCOUNT_PATH';
const MAX_CONFIG = 128 * 1024;
function bounded(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_CONFIG) throw new Error('unsupported_config_size');
  return fs.readFileSync(file, 'utf8');
}
function accountInfo(file) {
  if (!file) return { configured: false, exists: false, validShape: false };
  if (!fs.existsSync(file)) return { configured: true, exists: false, validShape: false };
  try {
    const account = JSON.parse(bounded(file));
    const stat = fs.statSync(file);
    const validShape = account?.type === 'service_account' &&
      typeof account.project_id === 'string' && !!account.project_id.trim() &&
      typeof account.client_email === 'string' && !!account.client_email.trim() &&
      typeof account.private_key === 'string' && /^-----BEGIN PRIVATE KEY-----\r?\n/.test(account.private_key);
    let privateKeyParses = false;
    if (validShape) { try { privateKeyParses = crypto.createPrivateKey(account.private_key).asymmetricKeyType === 'rsa'; } catch { /* no error contents */ } }
    return { configured: true, exists: true, validShape, privateKeyParses,
      ownerIsService: typeof process.geteuid === 'function' ? stat.uid === process.geteuid() : null,
      privateMode: process.platform === 'win32' ? null : (stat.mode & 0o077) === 0,
      // Internal only: stripped before reporting.
      project: validShape ? account.project_id : null };
  } catch { return { configured: true, exists: true, validShape: false, parseFailed: true }; }
}
function publicAccount(info) { const { project, ...safe } = info; return safe; }

async function main() {
  const repo = process.cwd(), home = os.homedir();
  const fromRepo = createRequire(path.join(repo, 'package.json'));
  const dotenv = fromRepo('dotenv');
  const disk = dotenv.parse(bounded(path.join(repo, '.env')));
  const runtime = {};
  let runtimeEnvironmentRead = false;
  const pids = path.join(home, '.pm2/pids');
  if (fs.existsSync(pids)) {
    for (const name of fs.readdirSync(pids).filter(n => /^ptap-api-\d+\.pid$/.test(n)).slice(0, 4)) {
      const pid = bounded(path.join(pids, name)).trim();
      if (!/^\d+$/.test(pid)) continue;
      try {
        for (const item of fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) {
          const index = item.indexOf('='); if (index > 0 && item.slice(0, index) === KEY) runtime[KEY] = item.slice(index + 1);
        }
        runtimeEnvironmentRead = true;
      } catch { /* do not guess that runtime equals disk */ }
    }
  }
  const effectivePath = runtime[KEY] || disk[KEY];
  const effective = accountInfo(effectivePath);
  const candidates = new Set();
  const envBackups = [];
  for (const directory of [repo, path.join(home, 'backups')]) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter(n => /^\.env(?:\.|$)/.test(n)).slice(0, 24)) {
      const file = path.join(directory, name);
      try { const config = dotenv.parse(bounded(file)); envBackups.push(Boolean(config[KEY]?.trim())); if (config[KEY]?.trim()) candidates.add(config[KEY].trim()); } catch { /* bounded unavailable config */ }
    }
  }
  // Only known application secret/config locations and Firebase-named JSON files.
  for (const directory of [path.join(home, 'secrets'), path.join(home, '.config/monitor-ptap'), path.join(home, 'backups')]) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter(n => /(?:firebase|service[-_]?account|adminsdk).*\.json$/i.test(n)).slice(0, 24)) candidates.add(path.join(directory, name));
  }
  const found = [...candidates].map(accountInfo);
  const projects = new Set(found.filter(x => x.validShape).map(x => x.project));
  if (effective.validShape) projects.add(effective.project);
  const clientProjects = new Set();
  let clientFilesFound = 0, androidPackageMatches = false;
  for (const file of [path.join(repo, 'apps/mobile/google-services.json'), path.join(repo, 'apps/mobile/android/app/google-services.json')]) {
    if (!fs.existsSync(file)) continue;
    clientFilesFound++;
    try {
      const client = JSON.parse(bounded(file));
      if (typeof client.project_info?.project_id === 'string') clientProjects.add(client.project_info.project_id);
      androidPackageMatches ||= client.client?.some(c => c.client_info?.android_client_info?.package_name === 'com.ptap.monitor') === true;
    } catch { /* do not expose config values */ }
  }
  const mysql = fromRepo('mysql2/promise');
  const connection = await mysql.createConnection({ host: disk.DB_HOST || '127.0.0.1', port: Number(disk.DB_PORT || 3306), user: disk.DB_USER, password: disk.DB_PASSWORD, database: disk.DB_NAME || 'monitor_ptap' });
  let tokenCounts;
  try {
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const [rows] = await connection.query(`SELECT COUNT(*) AS total, COUNT(DISTINCT t.user_id) AS users,
      COALESCE(SUM(t.platform = 'android'), 0) AS android,
      COALESCE(SUM(u.is_active = 1), 0) AS activeAccountTokens,
      COALESCE(SUM(t.last_seen_at >= NOW() - INTERVAL 30 DAY), 0) AS seenWithin30Days
      FROM device_push_token t LEFT JOIN users u ON u.id = t.user_id`);
    tokenCounts = Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
    await connection.query('ROLLBACK');
  } finally { await connection.end(); }
  console.log(JSON.stringify({ at: new Date().toISOString(), runtime: process.version,
    helperSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    configuration: { envKey: KEY, diskConfigured: Boolean(disk[KEY]?.trim()), runtimeEnvironmentRead,
      runtimeConfigured: Boolean(runtime[KEY]?.trim()), effective: publicAccount(effective) },
    boundedSearch: { envConfigsRead: envBackups.length, envConfigsWithPath: envBackups.filter(Boolean).length,
      credentialCandidates: found.length, validServiceAccounts: found.filter(x => x.validShape && x.privateKeyParses).length },
    client: { filesFound: clientFilesFound, androidPackageMatches, projectAlignment: projects.size && clientProjects.size ? [...clientProjects].every(p => projects.has(p)) : null },
    tokenCounts, providerAuthenticationChecked: false, messageSent: false, databaseWrites: false,
    limitation: 'Token project cannot be inferred from opaque registration token; local config matching is not delivery proof.' }));
}
module.exports = { accountInfo, publicAccount };
if (require.main === module) main().catch(err => { console.error(JSON.stringify({ error: 'push_readiness_failed', code: err.code || err.name })); process.exitCode = 1; });
