#!/usr/bin/env node
'use strict';
// First-party read-only review. Never imports/executes dump SQL or accepts a baseline.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const FIELDS = ['id', 'at', 'plant_id', 'target', 'command', 'status', 'user_id', 'user_name', 'user_email', 'role', 'written_value', 'confirmed_value', 'signature', 'prev_signature'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function facts(row) {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('unsupported_id');
  const at = row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString();
  return [id, at, ...FIELDS.slice(2, 12).map(field => row[field] ?? null)];
}
function seal(row, secret) {
  return crypto.createHmac('sha256', secret).update(`${row.prev_signature ?? 'GENESIS'}\x1f${facts(row).map(v => v === null ? '\0' : String(v)).join('\x1f')}`).digest('hex');
}
function projection(row) { return [...facts(row), row.signature ?? null, row.prev_signature ?? null]; }
function inspect(rows, secret) {
  const ordered = [], signed = [], byPrevious = new Map(), seen = new Set();
  const result = { total: rows.length, signed: 0, unsigned: 0, malformedSignatures: 0, pending: 0, invalidHmac: 0, brokenLinks: 0, duplicateSignatures: 0, genesisLinks: 0, tip: null };
  const signatures = new Set();
  for (const row of rows) {
    if (row.status === 'pending') result.pending++;
    if (row.signature === null || row.signature === undefined) { result.unsigned++; continue; }
    if (typeof row.signature !== 'string' || !/^[a-f0-9]{64}$/.test(row.signature)) { result.malformedSignatures++; continue; }
    signed.push(row);
    if (signatures.has(row.signature)) result.duplicateSignatures++;
    signatures.add(row.signature);
    const key = row.prev_signature ?? null;
    if (key === null) result.genesisLinks++;
    if (!byPrevious.has(key)) byPrevious.set(key, []);
    byPrevious.get(key).push(row);
  }
  function walk(start) {
    let next = start;
    while (next && !seen.has(next)) {
      seen.add(next); ordered.push(next);
      next = byPrevious.get(next.signature)?.find(row => !seen.has(row));
    }
  }
  for (const row of byPrevious.get(null) ?? []) walk(row);
  for (const row of signed) if (!seen.has(row)) walk(row);
  let previous = null;
  for (const row of ordered) {
    if ((row.prev_signature ?? null) !== previous) result.brokenLinks++;
    if (!equal(seal(row, secret), row.signature)) result.invalidHmac++;
    previous = row.signature;
  }
  result.signed = signed.length;
  result.tip = previous;
  result.signedProjectionSha256 = sha(JSON.stringify(ordered.map(projection)));
  result.allProjectionSha256 = sha(JSON.stringify([...rows].sort((a,b) => Number(a.id)-Number(b.id)).map(projection)));
  result.eligibleForBaseline = !result.unsigned && !result.malformedSignatures && !result.pending && !result.invalidHmac && !result.brokenLinks && !result.duplicateSignatures;
  return result;
}

// Deliberately narrow mysqldump VALUES parser: only quoted strings, NULL and safe
// decimal integers. It rejects SQL expressions/unsupported encodings, never evals.
function parseValues(input) {
  let i = 0;
  const rows = [];
  const ws = () => { while (/\s/.test(input[i] ?? '') && i < input.length) i++; };
  const expect = c => { ws(); if (input[i++] !== c) throw new Error('unsupported_dump_syntax'); };
  const escapes = { '0': '\0', n: '\n', r: '\r', t: '\t', b: '\b', Z: '\x1a', '\\': '\\', "'": "'", '"': '"' };
  function value() {
    ws();
    if (input[i] === "'") {
      i++; let text = '';
      while (i < input.length) {
        const c = input[i++];
        if (c === "'") { if (input[i] === "'") { text += "'"; i++; } else return text; }
        else if (c === '\\') {
          const escaped = input[i++];
          if (!Object.hasOwn(escapes, escaped)) throw new Error('unsupported_dump_escape');
          text += escapes[escaped];
        } else text += c;
      }
      throw new Error('unterminated_dump_string');
    }
    const match = /^(NULL|-?\d+)(?=\s*[,)]|$)/.exec(input.slice(i));
    if (!match) throw new Error('unsupported_dump_value');
    i += match[0].length;
    if (match[0] === 'NULL') return null;
    const n = Number(match[0]);
    if (!Number.isSafeInteger(n)) throw new Error('unsupported_dump_number');
    return n;
  }
  while (i < input.length) {
    expect('('); const row = [];
    while (true) { row.push(value()); ws(); if (input[i] !== ',') break; i++; }
    expect(')'); rows.push(row); ws();
    if (input[i] === ';') { i++; ws(); if (i !== input.length) throw new Error('trailing_dump_content'); break; }
    expect(',');
  }
  return rows;
}
function parseDump(sql) {
  if (/SET[^;]*sql_mode[^;]*NO_BACKSLASH_ESCAPES/i.test(sql)) throw new Error('unsupported_dump_sql_mode');
  const schema = /CREATE TABLE `command_log` \(([\s\S]*?)\) ENGINE=/.exec(sql);
  if (!schema) throw new Error('missing_dump_schema');
  const columns = schema[1].split('\n').filter(line => /^\s*`/.test(line)).map(line => line.match(/`([^`]+)`/)[1]);
  if (FIELDS.some(field => !columns.includes(field)) || new Set(columns).size !== columns.length) throw new Error('unsupported_dump_schema');
  const rows = [];
  for (const line of sql.split(/\r?\n/)) {
    if (!line.startsWith('INSERT INTO `command_log`')) continue;
    const match = /^INSERT INTO `command_log` VALUES (.*);$/.exec(line);
    if (!match) throw new Error('unsupported_dump_insert');
    for (const values of parseValues(`${match[1]};`)) {
      if (values.length !== columns.length) throw new Error('dump_column_count_mismatch');
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      rows.push(Object.fromEntries(FIELDS.map(field => [field, row[field]])));
    }
  }
  const ids = new Set(rows.map(row => row.id));
  if (ids.size !== rows.length) throw new Error('duplicate_dump_id');
  return rows;
}
function compare(live, backup) {
  const a = new Map(live.map(row => [String(row.id), JSON.stringify(projection(row))]));
  const b = new Map(backup.map(row => [String(row.id), JSON.stringify(projection(row))]));
  let same = 0, changed = 0, absentFromLive = 0, absentFromBackup = 0;
  for (const [id, value] of b) { if (!a.has(id)) absentFromLive++; else if (a.get(id) === value) same++; else changed++; }
  for (const id of a.keys()) if (!b.has(id)) absentFromBackup++;
  return { same, changed, absentFromLive, absentFromBackup };
}

async function main() {
  const repo = process.cwd();
  const fromRepo = createRequire(path.join(repo, 'package.json'));
  const env = fromRepo('dotenv').parse(fs.readFileSync(path.join(repo, '.env')));
  if (!env.COMMAND_SIGNING_SECRET?.trim()) throw new Error('explicit_signing_secret_missing');
  const secret = env.COMMAND_SIGNING_SECRET.trim();
  const mysql = fromRepo('mysql2/promise');
  const directory = path.join(os.homedir(), '.local/state/monitor-ptap/command-ledger-review', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Refuse symlinks, foreign ownership, or group/world access in evidence location.
  for (const target of [path.dirname(directory), directory]) {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.geteuid() || (stat.mode & 0o077)) throw new Error('evidence_path_not_private');
  }
  const writePrivate = (name, value) => {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    fs.writeFileSync(path.join(directory, name), bytes, { mode: 0o600, flag: 'wx' });
    return { file: name, bytes: bytes.length, sha256: sha(bytes) };
  };
  const connection = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME || 'monitor_ptap' });
  let rows, fullRows;
  try {
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    [fullRows] = await connection.query('SELECT * FROM command_log ORDER BY id ASC');
    rows = fullRows.map(row => Object.fromEntries(FIELDS.map(field => [field, row[field]])));
    await connection.query('ROLLBACK');
  } finally { await connection.end(); }
  const report = {
    schema: 'ptap-ledger-readonly-review/1', at: new Date().toISOString(),
    helperSha256: sha(fs.readFileSync(__filename)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    runtime: process.version, live: inspect(rows, secret), liveEvidence: writePrivate('live-command-facts.private.json', rows),
    fullLiveEvidence: writePrivate('live-command-full.private.json', fullRows), backups: [],
    limitations: ['No pre-existing trusted checkpoint: prior deletion cannot be excluded.', 'Backups are independent saved observations on the same host; no external authenticity claimed.', 'Producers remained running; this is a read-only snapshot, not an activation freeze.', 'Unsigned history cannot be accepted or silently re-signed by the baseline tool.'],
  };
  const backupDir = path.join(os.homedir(), 'backups');
  const names = fs.readdirSync(backupDir).filter(name => /^ptapapp-\d{8}-\d{4}\.sql\.gz$/.test(name)).sort().reverse();
  if (names.length > 64) throw new Error('backup_count_limit');
  for (const name of names) {
    const file = path.join(backupDir, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('backup_file_limit');
    const bytes = fs.readFileSync(file);
    const backup = { name, bytes: bytes.length, sha256: sha(bytes) };
    try {
      const saved = parseDump(zlib.gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'));
      backup.verification = inspect(saved, secret); backup.comparisonToLive = compare(rows, saved);
    } catch (err) { backup.inconclusive = true; backup.error = /^[a-z_]+$/.test(err.message) ? err.message : 'backup_parse_failed'; }
    report.backups.push(backup);
  }
  let mysqlUid = null;
  try { mysqlUid = Number(execFileSync('id', ['-u', 'mysql'], { encoding: 'utf8' }).trim()); } catch { /* recorded below */ }
  report.permissions = { ownerUid: process.geteuid(), mysqlUid, distinctIdentity: mysqlUid !== null && mysqlUid !== process.geteuid(), directoryMode: (fs.statSync(directory).mode & 0o777).toString(8), evidenceMode: (fs.statSync(path.join(directory, report.liveEvidence.file)).mode & 0o777).toString(8), proposedCheckpointPath: path.join(os.homedir(), '.local/state/monitor-ptap/command-ledger/checkpoint.json'), checkpointCreated: false };
  const manifest = writePrivate('review-report.json', report);
  console.log(JSON.stringify({ ...report, evidenceDirectory: directory, reportManifest: manifest }));
}
module.exports = { facts, seal, inspect, parseValues, parseDump, compare };
if (require.main === module) main().catch(err => {
  console.error(JSON.stringify({ error: /^[a-z_]+$/.test(err.message) ? err.message : 'ledger_review_failed', code: err.code || err.name }));
  process.exitCode = 1;
});
