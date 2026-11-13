#!/usr/bin/env node
'use strict';
// Read-only, ordinary-user supplement AFTER build-android exits0 including final signer preflight.
// Never invokes signing tools, builds, installs, network, or raw-resource output.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const STAGE = '/home/xpertic_app/android-build/releases/release-e2cf4d4ee164-CFMDWd';
const APK = `${STAGE}/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`;
const GOOGLE = `${STAGE}/apps/mobile/google-services.json`;
const AAPT = '/home/xpertic_app/android-build/sdk/build-tools/37.0.0/aapt2';
const ORIGIN = 'https://aquora.xpertic.co';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = condition => { if (!condition) throw new Error('Artifact inspection incomplete; private tool output suppressed.'); };

function readRegular(file, limit) {
  assert(fs.realpathSync(file) === file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    assert(before.isFile() && before.size > 0 && before.size <= limit);
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    assert(bytes.length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs);
    return bytes;
  } finally { fs.closeSync(fd); }
}

function run(binary, args, limit) {
  const result = spawnSync(binary, args, { timeout: 30000, maxBuffer: limit,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  assert(!result.error && result.status === 0 && Buffer.isBuffer(result.stdout) && result.stdout.length <= limit);
  return result.stdout;
}

function resourceStrings(output) {
  const strings = new Map();
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    if (/^\s*resource\s+0x[0-9a-f]+\s+/i.test(line)) {
      current = line.match(/\b(?:[^\s:]+:)?string\/(google_app_id|project_id|gcm_defaultSenderId)\b/)?.[1] || null;
      if (current && !strings.has(current)) strings.set(current, new Set());
    } else if (current) {
      const value = line.match(/^\s*(?:\([^)]*\)\s*)+"([^"\r\n]*)"\s*$/)?.[1];
      if (value !== undefined) strings.get(current).add(value);
    }
  }
  return strings;
}

function matchesResource(strings, name, expected) {
  const values = strings.get(name);
  return Boolean(values && values.size === 1 && values.has(expected));
}

function privateEntry(name) {
  const normalized = name.replace(/\\/g, '/');
  return /(?:^|\/)\.env(?:$|[._-])/i.test(normalized) ||
    /\.(?:pem|key|keystore|jks|p12|p8|pfx)$/i.test(normalized) ||
    /(?:^|\/)[^/]*(?:adminsdk|service[-_]?account|private[-_]?key|credentials?)[^/]*\.json$/i.test(normalized);
}

function textContains(bytes, text) {
  return bytes.includes(Buffer.from(text)) || bytes.includes(Buffer.from(text, 'utf16le'));
}

function inspect() {
  assert(process.platform === 'linux' && process.getuid() !== 0);
  const initial = fs.statSync(APK);
  const report = { inspectionSucceeded: false, sha256: null, sizeBytes: null,
    postNotificationsPermission: false, firebaseProjectMatches: false, firebaseAppIdMatches: false,
    firebaseSenderMatches: false, productionHttpsOriginInBundle: false, packagedApiOriginExact: false,
    noTrycloudflareInBundles: false, noTrycloudflareInPackagedConfig: false,
    noPrivateCredentialFileNames: false, noPrivateCredentialJsonMaterial: false, bundlesInspected: 0, jsonEntriesInspected: 0 };
  try {
    const bytes = readRegular(APK, 256 * 1024 * 1024);
    report.sha256 = hash(bytes); report.sizeBytes = bytes.length;
    const googleBytes = readRegular(GOOGLE, 1024 * 1024);
    const receipt = JSON.parse(readRegular(path.join(STAGE, '.ptap-release.json'), 64 * 1024).toString('utf8'));
    assert(hash(googleBytes) === receipt.firebaseSha256);
    const settings = JSON.parse(googleBytes.toString('utf8'));
    assert(settings.type !== 'service_account' && !settings.private_key && settings.project_info?.project_id === 'desarrollo-1b2ba');
    const clients = settings.client?.filter(client => client.client_info?.android_client_info?.package_name === 'com.ptap.monitor');
    assert(clients?.length === 1);
    const permissions = run(AAPT, ['dump', 'permissions', APK], 1024 * 1024).toString('utf8');
    report.postNotificationsPermission = /uses-permission[^\r\n]*name=['"]android\.permission\.POST_NOTIFICATIONS['"]/.test(permissions);
    const strings = resourceStrings(run(AAPT, ['dump', 'resources', APK], 16 * 1024 * 1024).toString('utf8'));
    report.firebaseProjectMatches = matchesResource(strings, 'project_id', settings.project_info.project_id);
    report.firebaseAppIdMatches = matchesResource(strings, 'google_app_id', clients[0].client_info.mobilesdk_app_id);
    report.firebaseSenderMatches = matchesResource(strings, 'gcm_defaultSenderId', String(settings.project_info.project_number));
    const entries = run('/usr/bin/unzip', ['-Z1', APK], 2 * 1024 * 1024).toString('utf8').split(/\r?\n/).filter(Boolean);
    assert(entries.length > 0 && entries.length <= 20000 && entries.every(name => !name.startsWith('/') && !name.split('/').includes('..')));
    report.noPrivateCredentialFileNames = !entries.some(privateEntry);
    const bundles = entries.filter(name => /^assets\/.*\.(?:bundle|hbc)$/.test(name));
    assert(bundles.length > 0 && bundles.length <= 4);
    report.noTrycloudflareInBundles = true;
    for (const name of bundles) {
      const bundle = run('/usr/bin/unzip', ['-p', APK, name], 64 * 1024 * 1024);
      report.productionHttpsOriginInBundle ||= textContains(bundle, ORIGIN);
      const lower = Buffer.from(bundle.toString('latin1').toLowerCase(), 'latin1');
      report.noTrycloudflareInBundles &&= !textContains(lower, 'trycloudflare');
      report.bundlesInspected++;
    }
    // expo-constants58 serializes the exact Constants.expoConfig object to assets/app.config.
    // api.ts reads extra.apiBaseUrl from that object; Hermes need not duplicate its literal URL.
    assert(entries.includes('assets/app.config'));
    const configEntry = name => /^assets\/(?:app\.config|app\.manifest|expo\.manifest)$/.test(name);
    const jsonEntries = entries.filter(name => /\.json$/i.test(name) || configEntry(name));
    assert(jsonEntries.length <= 128);
    let jsonBytes = 0;
    report.noPrivateCredentialJsonMaterial = true;
    report.noTrycloudflareInPackagedConfig = true;
    for (const name of jsonEntries) {
      const contents = run('/usr/bin/unzip', ['-p', APK, name], 512 * 1024);
      jsonBytes += contents.length; assert(jsonBytes <= 8 * 1024 * 1024);
      report.noPrivateCredentialJsonMaterial &&= !/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|"type"\s*:\s*"service_account"|"private_key"\s*:\s*"[^"\r\n]+/.test(contents.toString('utf8'));
      if (configEntry(name)) {
        const lower = Buffer.from(contents.toString('latin1').toLowerCase(), 'latin1');
        report.noTrycloudflareInPackagedConfig &&= !textContains(lower, 'trycloudflare');
        if (name === 'assets/app.config') report.packagedApiOriginExact = JSON.parse(contents.toString('utf8')).extra?.apiBaseUrl === ORIGIN;
      }
      report.jsonEntriesInspected++;
    }
    const final = fs.statSync(APK);
    assert(initial.ino === final.ino && initial.size === final.size && initial.mtimeMs === final.mtimeMs);
    report.inspectionSucceeded = true;
  } catch { /* Never expose resource values, configuration contents, bundle bytes or tool errors. */ }
  console.log(JSON.stringify(report));
  const required = ['inspectionSucceeded', 'postNotificationsPermission', 'firebaseProjectMatches', 'firebaseAppIdMatches',
    'firebaseSenderMatches', 'packagedApiOriginExact', 'noTrycloudflareInBundles', 'noTrycloudflareInPackagedConfig',
    'noPrivateCredentialFileNames', 'noPrivateCredentialJsonMaterial'];
  if (required.some(name => !report[name])) process.exitCode = 1;
}

module.exports = { resourceStrings, matchesResource, privateEntry, textContains };
if (require.main === module) {
  try { assert(process.argv.length === 2); inspect(); }
  catch { console.log(JSON.stringify({ inspectionSucceeded: false })); process.exitCode = 1; }
}
