#!/usr/bin/env node
'use strict';

// Run on the production VM in a user-owned interactive terminal. Never pass secrets as arguments.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { createRequire } = require('node:module');

function envValue(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('El valor contiene caracteres no permitidos.');
  for (const quote of ["'", '`', '"']) {
    if (!value.includes(quote) && (quote !== '"' || !/\\[nr]/.test(value))) return quote + value + quote;
  }
  throw new Error('El valor no se puede representar de forma segura en dotenv.');
}

function renderEnv(original, values) {
  const names = new Set(Object.keys(values));
  // Reject multiline assignments for changed keys rather than leave orphaned secret fragments.
  const lines = original.split(/\r?\n/);
  const kept = lines.filter(line => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return true;
    const value = match[2];
    if (["'", '"', '`'].includes(value[0]) && !value.slice(1).includes(value[0])) {
      throw new Error('Asignación dotenv multilínea: requiere revisión manual.');
    }
    if (!names.has(match[1])) return true;
    return false;
  });
  return kept.join('\n').replace(/\n*$/, '\n') + Object.entries(values).map(([key, value]) => `${key}=${envValue(value)}`).join('\n') + '\n';
}

function hiddenPassword() {
  return new Promise((resolve, reject) => {
    let password = '';
    const input = process.stdin;
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    process.stdout.write('Contraseña SMTP (oculta): ');
    function finish(error) {
      input.removeListener('keypress', onKey);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(password);
    }
    function onKey(character, key = {}) {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new Error('Cancelado.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') password = Array.from(password).slice(0, -1).join('');
      else if (!key.ctrl && !key.meta && character && !/[\x00-\x1f\x7f]/.test(character)) password += character;
    }
    input.on('keypress', onKey);
  });
}

function persist(envPath, original, replacement) {
  const stat = fs.lstatSync(envPath);
  if (!stat.isFile() || stat.uid !== process.getuid()) throw new Error('El .env debe ser un archivo regular del usuario actual.');
  if (fs.readFileSync(envPath, 'utf8') !== original) throw new Error('.env cambió durante la verificación; no se guardó.');
  const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const backup = `${envPath}.bak-smtp-${suffix}`;
  const temporary = `${envPath}.bak-smtp-tmp-${suffix}`;
  // Create a private backup before atomically replacing the configuration on the same filesystem.
  fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, replacement); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, envPath);
    const dirFd = fs.openSync(path.dirname(envPath), 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return backup;
}

async function main() {
  if (process.argv.length > 2) throw new Error('No se aceptan argumentos ni credenciales por línea de comandos.');
  if (process.platform !== 'linux' || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Se requiere una terminal interactiva Linux.');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('La validación TLS del proceso está deshabilitada.');
  const repo = process.cwd();
  const envPath = path.join(repo, '.env');
  const stat = fs.lstatSync(envPath);
  if (!stat.isFile() || stat.uid !== process.getuid()) throw new Error('El .env debe ser un archivo regular del usuario actual.');
  const original = fs.readFileSync(envPath, 'utf8');
  const localRequire = createRequire(path.join(repo, 'package.json'));
  const nodemailer = localRequire('nodemailer');
  const dotenv = localRequire('dotenv');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = prompt => new Promise(resolve => rl.question(prompt, answer => resolve(answer.trim())));
  let host, user, from;
  try {
    host = await ask('Hostname SMTP confirmado por el proveedor: ');
    user = await ask('Buzón SMTP completo: ');
    from = await ask('Remitente autorizado (vacío = Monitor PTAP <buzón>): ');
  } finally { rl.close(); }
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) || !host.includes('.') || /\.\./.test(host)) throw new Error('Hostname SMTP inválido.');
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(user)) throw new Error('Buzón inválido.');
  from ||= `Monitor PTAP <${user}>`;
  const password = await hiddenPassword();
  if (!password) throw new Error('Contraseña vacía.');
  const values = { EMAIL_TRANSPORT: 'smtp', EMAIL_FROM: from, SMTP_HOST: host, SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: user, SMTP_PASS: password };
  const replacement = renderEnv(original, values);
  const parsed = dotenv.parse(replacement);
  if (Object.entries(values).some(([key, value]) => parsed[key] !== value)) throw new Error('La configuración no supera la validación dotenv.');
  const transport = nodemailer.createTransport({ host, port: 465, secure: true, requireTLS: true,
    auth: { user, pass: password }, tls: { servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true },
    logger: false, debug: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
  try {
    await transport.verify();
  } catch (error) {
    // Do not print SMTP responses, error messages or credential-bearing transport objects.
    const code = String(error.code || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '').slice(0, 40);
    throw new Error(`Verificación SMTP fallida (${code}). No se modificó .env.`);
  } finally { transport.close(); }
  const backup = persist(envPath, original, replacement);
  console.log(`TLS y autenticación SMTP verificados; .env guardado con permisos 0600. Respaldo privado: ${path.basename(backup)}`);
  console.log('No se envió correo. No se reinició la API. Coordinar la activación y prueba de entrega.');
}

module.exports = { envValue, renderEnv, persist };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
