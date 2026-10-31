'use strict';
// Synthetic Linux fixture only: never run the unmodified installer or real service/network commands.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const installerPath = path.join(__dirname, 'ptap-install-renewed-tls.sh');
const original = fs.readFileSync(installerPath, 'utf8').replace(/\r\n/g, '\n');
console.log('TLS fixture source SHA256', crypto.createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex'));
console.log('TLS fixture test SHA256', crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'));

function shellQuote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, `Expected exactly one fixture substitution: ${from}`);
  return source.replace(from, to);
}

function fixture(scenario) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptap-tls-fixture-'));
  fs.chmodSync(directory, 0o700);
  const src = path.join(directory, 'source');
  const dest = path.join(directory, 'dest');
  const bin = path.join(directory, 'bin');
  for (const entry of [src, dest, bin]) fs.mkdirSync(entry, { mode: 0o700 });
  fs.writeFileSync(path.join(src, 'fullchain.pem'), 'synthetic-new-cert\n');
  fs.writeFileSync(path.join(src, 'privkey.pem'), 'synthetic-new-key\n', { mode: 0o600 });
  fs.writeFileSync(path.join(dest, 'fullchain.pem'), 'synthetic-old-cert\n');
  fs.writeFileSync(path.join(dest, 'privkey.pem'), 'synthetic-old-key\n', { mode: 0o600 });
  let body = replaceOnce(original, '[[ $EUID -eq 0 && $# -eq 0 ]]', '[[ ${PTAP_TLS_FIXTURE:-} == 1 && $# -eq 0 ]]');
  body = replaceOnce(body, 'DOMAIN=aquora.xpertic.co', 'DOMAIN=fixture.invalid');
  body = replaceOnce(body, 'SRC=/home/xpertic_app/letsencrypt/config/live/aquora.xpertic.co', `SRC=${shellQuote(src)}`);
  body = replaceOnce(body, 'DEST=/etc/ssl/ptap', `DEST=${shellQuote(dest)}`);
  body = replaceOnce(body, 'mktemp -d /etc/ssl/ptap/backup-XXXXXXXX', `mktemp -d ${shellQuote(path.join(dest, 'backup-XXXXXXXX'))}`);
  assert.doesNotMatch(body, /\/etc\/ssl\/ptap|\/home\/xpertic_app|aquora\.xpertic\.co/);
  const dispatcher = path.join(directory, 'dispatch.cjs');
  fs.writeFileSync(dispatcher, `
const fs=require('node:fs'),path=require('node:path');
const name=process.argv[2],args=process.argv.slice(3),dir=process.env.PTAP_TLS_FIXTURE_DIR;
if(!dir||process.env.PTAP_TLS_FIXTURE!=='1')process.exit(98);
fs.appendFileSync(path.join(dir,'events'),JSON.stringify({name,args})+'\\n');
if(name==='curl'){
 const countFile=path.join(dir,'curl-count');let n=fs.existsSync(countFile)?Number(fs.readFileSync(countFile,'utf8')):0;fs.writeFileSync(countFile,String(++n));
 if(process.env.PTAP_TLS_SCENARIO==='always-fail'||n===1)process.exit(60);
 process.stdout.write('{"ok":true}\\n');
}else if(name==='openssl'){
 if(args.includes('-pubkey'))process.stdout.write('synthetic-matching-key');
 else if(args.includes('-pubin'))process.stdin.pipe(process.stdout);
 else if(args.includes('-pubout'))process.stdout.write(process.env.PTAP_TLS_SCENARIO==='mismatch'?'synthetic-mismatch':'synthetic-matching-key');
}else if(name==='install'){
 const source=args.at(-2),target=args.at(-1);
 if(!source.startsWith(dir+'/source/')||!target.startsWith(dir+'/dest/'))process.exit(97);
 fs.copyFileSync(source,target);fs.chmodSync(target,parseInt(args[args.indexOf('-m')+1],8));
}else if(name==='systemctl'){
 if(args.join(' ')!=='reload nginx')process.exit(96);
}else if(!['nginx','sleep'].includes(name))process.exit(95);
`);
  for (const command of ['curl', 'openssl', 'install', 'systemctl', 'nginx', 'sleep']) {
    fs.writeFileSync(path.join(bin, command), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(dispatcher)} ${shellQuote(command)} "$@"\n`, { mode: 0o700 });
  }
  const fixturePath = path.join(directory, 'installer-fixture.sh');
  fs.writeFileSync(fixturePath, body, { mode: 0o600 });
  try {
    const result = spawnSync('/bin/bash', [fixturePath], { encoding: 'utf8', timeout: 15000,
      env: { PATH: `${bin}:/usr/bin:/bin`, PTAP_TLS_FIXTURE: '1', PTAP_TLS_FIXTURE_DIR: directory, PTAP_TLS_SCENARIO: scenario } });
    assert.ifError(result.error);
    const events = fs.readFileSync(path.join(directory, 'events'), 'utf8').trim().split('\n').map(JSON.parse);
    return { result, events, cert: fs.readFileSync(path.join(dest, 'fullchain.pem'), 'utf8'), key: fs.readFileSync(path.join(dest, 'privkey.pem'), 'utf8') };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('one stale worker TLS failure then success retains renewed certificate without rollback', { skip: process.platform !== 'linux' }, () => {
  const { result, events, cert, key } = fixture('eventual-success');
  assert.equal(result.status, 0, `Installer must tolerate first curl60 and retry: ${result.stderr}`);
  assert.equal(cert, 'synthetic-new-cert\n');
  assert.equal(key, 'synthetic-new-key\n');
  assert.equal(events.filter(event => event.name === 'systemctl').length, 1, 'No rollback reload after recovery');
  assert.equal(events.filter(event => event.name === 'curl').length, 2);
});

test('persistent HTTPS failure exhausts bounded retry and restores both previous files', { skip: process.platform !== 'linux' }, () => {
  const { result, events, cert, key } = fixture('always-fail');
  assert.notEqual(result.status, 0);
  assert.equal(cert, 'synthetic-old-cert\n');
  assert.equal(key, 'synthetic-old-key\n');
  assert.equal(events.filter(event => event.name === 'systemctl').length, 2, 'Initial reload plus rollback reload');
  const curls = events.filter(event => event.name === 'curl');
  assert.equal(curls.length, 10, 'Bounded ten-attempt retry');
  for (const { args } of curls) {
    assert.equal(args[args.indexOf('--max-time') + 1], '3', 'Every HTTPS request is bounded to three seconds');
    assert.ok(args.includes('--resolve'));
    assert.ok(args.includes('fixture.invalid:443:127.0.0.1'));
  }
});

test('mismatching renewed certificate and key never install or reload', { skip: process.platform !== 'linux' }, () => {
  const { result, events, cert, key } = fixture('mismatch');
  assert.notEqual(result.status, 0);
  assert.equal(cert, 'synthetic-old-cert\n');
  assert.equal(key, 'synthetic-old-key\n');
  assert.equal(events.filter(event => ['install', 'systemctl', 'curl'].includes(event.name)).length, 0);
});
