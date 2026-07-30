/**
 * PRUEBA DE CAMPO — canal OFICIAL de comandos contra el PLC real (válvula de Sirena).
 *
 * Proceso ACOTADO y autoterminante (no deja demonio): arranca la app NestJS real en PORT,
 * espera a que el puente OPC UA conecte, diagnostica el interlock, ejecuta el/los comandos por
 * HTTP (pasando por JwtAuthGuard + PermissionGuard + PlantScopeGuard → WriteService: RBAC del
 * mapping, interlock, idempotencia, read-back con timeout, rollback y auditoría), verifica que
 * NO quede bit latente y se cierra.
 *
 * Env:
 *   PORT=4001                 puerto de la instancia de prueba
 *   FT_EMAIL=...              cuenta REAL (activa) cuyo JWT se firma para llamar
 *   FT_MODE=preflight|single|burst|single+burst
 *   FT_BURST_SECONDS=120      duración de la ráfaga
 *   FT_BURST_INTERVAL_MS=5000 intervalo entre comandos
 *
 * Uso:  FT_EMAIL=x@y.com FT_MODE=single npm exec -w @ptap/api -- tsx scripts/fieldtest-valve-run.ts
 */
import 'reflect-metadata';
import '../src/config/load-env';
import { NestFactory } from '@nestjs/core';
import { createPool, type RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/modules/app.module';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';
import { JwtService } from '../src/modules/auth/jwt.service';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { CONNECTIVITY_ADAPTER } from '../src/infrastructure/connectivity/connectivity.tokens';
import type { ConnectivityAdapter } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import type { Role } from '@ptap/shared';

const PORT = Number(process.env.PORT ?? 4001);
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = process.env.FT_EMAIL ?? '';
const MODE = process.env.FT_MODE ?? 'preflight';
const BURST_SECONDS = Number(process.env.FT_BURST_SECONDS ?? 120);
const BURST_INTERVAL_MS = Number(process.env.FT_BURST_INTERVAL_MS ?? 5000);
const PLANT = 'sirena';
const TARGET = 'valve1';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().slice(11, 23);
const bits = (n: unknown): string => {
  const u = Number(n) & 0xffff;
  const s: number[] = [];
  for (let b = 0; b < 16; b++) if (u & (1 << b)) s.push(b);
  return `{${s.join(',')}}`;
};

const OUT_EL = { plantId: PLANT, channel: 'intOut', sourceBuffer: 'INT_OUT_SIRENA', index: 0 };
const IN_EL = { plantId: PLANT, channel: 'intIn', sourceBuffer: 'INT_IN_SIRENA', index: 0 };

async function mintJwt(email: string): Promise<{ token: string; role: string; plant: string }> {
  const pool = createPool({ ...readDatabaseConfig(), waitForConnections: true, connectionLimit: 2 });
  try {
    const [rows] = await pool.query<(RowDataPacket & { id: string; email: string; name: string; role: string; plant: string; is_active: number })[]>(
      'SELECT id, email, name, role, plant, is_active FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (rows.length === 0) throw new Error(`no existe el usuario ${email}`);
    const u = rows[0];
    if (u.is_active !== 1) throw new Error(`la cuenta ${email} no está activa (JwtAuthGuard la rechazaría)`);
    const token = new JwtService().sign({ sub: u.id, email: u.email, name: u.name, role: u.role as Role, plant: u.plant });
    return { token, role: u.role, plant: u.plant };
  } finally {
    await pool.end();
  }
}

interface CallResult { n: number; at: string; http: number; status?: string; reason?: string | null; written?: unknown; confirmed?: unknown; prev?: unknown; seq?: number | null; ms: number }

async function callCommand(token: string, n: number): Promise<CallResult> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/plants/${PLANT}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ command: 'open', target: TARGET }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { raw: text }; }
  const inner = (body.status ? body : (body.message as Record<string, unknown>) ?? body) as Record<string, unknown>;
  return {
    n, at: now(), http: res.status, ms: Date.now() - t0,
    status: inner.status as string, reason: (inner.reason as string) ?? null,
    written: inner.writtenValue, confirmed: inner.confirmedValue, prev: inner.previousValue,
    seq: (inner.interlockSequence as number) ?? null,
  };
}

async function main(): Promise<void> {
  if (!EMAIL) { console.error('Falta FT_EMAIL'); process.exit(2); }
  console.log(`\n════════ PRUEBA DE CAMPO — válvula ${PLANT}/${TARGET} ════════`);
  console.log(`modo=${MODE}  puerto=${PORT}  ${new Date().toISOString()}`);

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  await app.listen(PORT);
  console.log(`${now()}  app de prueba escuchando en ${BASE}`);

  const adapter = app.get<ConnectivityAdapter>(CONNECTIVITY_ADAPTER);
  const cache = app.get(PlantCache);

  try {
    // ── 1. esperar puente ──
    console.log(`${now()}  esperando puente OPC UA...`);
    for (let i = 0; i < 90 && adapter.getBridgeStatus() !== 'Connected'; i++) await sleep(1000);
    const sec = adapter.getWriteSecurity();
    console.log(`${now()}  bridge=${adapter.getBridgeStatus()}  writeSecurity: secure=${sec.secure} mode=${sec.securityMode} identity=${sec.identity}`);
    if (adapter.getBridgeStatus() !== 'Connected') throw new Error('el puente no llegó a Connected');

    // ── 2. esperar snapshot de la planta ──
    for (let i = 0; i < 40 && !cache.get(PLANT); i++) await sleep(1000);
    const snap = cache.get(PLANT);
    console.log(`${now()}  snapshot ${PLANT}: ${snap ? `sequence=${snap.sequence} señales=${Object.keys(snap.signals).length}` : 'AUSENTE'}`);

    // ── 3. INTERLOCK: esperar a que el puente OBSERVE movimiento real del dato.
    // El interlock exige liveness==='live' por decisión DELIBERADA de seguridad (ver
    // test/write-service.test.ts:183): para accionar equipo no basta sesión viva, hay que estar
    // viendo moverse el dato. `live` requiere un CAMBIO de valor dentro de LIVENESS_LIVE_SEC, y
    // el primer frame nunca cuenta como cambio — así que hay que darle tiempo. Se vigila la
    // liveness DEL SNAPSHOT EN CACHE, que es exactamente lo que lee el interlock.
    const WAIT_LIVE_S = Number(process.env.FT_WAIT_LIVE_S ?? 150);
    console.log(`${now()}  esperando liveness='live' del snapshot en cache (máx ${WAIT_LIVE_S}s)...`);
    let live = false;
    for (let i = 0; i < WAIT_LIVE_S; i++) {
      const s = cache.get(PLANT);
      const st = s?.liveness.state;
      const lca = s?.liveness.lastChangeAt ?? null;
      const age = lca ? (Date.now() - new Date(lca).getTime()) / 1000 : null;
      if (i % 5 === 0 || st === 'live') {
        console.log(`   +${String(i).padStart(3)}s  liveness=${st ?? 'sin snapshot'}  seq=${s?.sequence ?? '-'}  lastChangeAt=${lca ?? 'null'}  antigüedad=${age === null ? 'n/a' : age.toFixed(1) + 's'}`);
      }
      if (st === 'live') { live = true; break; }
      await sleep(1000);
    }
    if (!live) {
      const s = cache.get(PLANT);
      console.log(`${now()}  ⚠️  el snapshot NO alcanzó 'live' (quedó '${s?.liveness.state}'). El interlock rechazará.`);
      console.log(`      Si lastChangeAt es null: el puente no vio NINGÚN cambio de valor en la ventana → planta en régimen quieto.`);
      console.log(`      Si la antigüedad es enorme: el sourceTimestamp del PLC está desfasado del reloj de la VM.`);
    } else {
      console.log(`${now()}  ✅ liveness='live' → el interlock debería permitir el comando.`);
    }

    // ── 4. estado crudo de los buffers antes de tocar nada ──
    const out0 = await adapter.readBufferElement(OUT_EL);
    const in0 = await adapter.readBufferElement(IN_EL);
    console.log(`${now()}  PREVIO  INT_OUT[0]=${out0.value} ${bits(out0.value)}   INT_IN[0]=${in0.value} ${bits(in0.value)}`);

    const { token, role, plant } = await mintJwt(EMAIL);
    console.log(`${now()}  JWT de ${EMAIL} (rol=${role}, planta=${plant}) listo`);

    const results: CallResult[] = [];

    // ── 5. comando único ──
    if (MODE.includes('single') || MODE === 'preflight') {
      console.log(`\n──── COMANDO ÚNICO por el canal oficial ────`);
      const r = await callCommand(token, 0);
      results.push(r);
      console.log(`${r.at}  HTTP ${r.http}  status=${r.status}  reason=${r.reason}  prev=${r.prev} written=${r.written} confirmed=${r.confirmed}  seq=${r.seq}  (${r.ms}ms)`);
    }

    // ── 6. ráfaga ──
    if (MODE.includes('burst')) {
      const total = Math.floor((BURST_SECONDS * 1000) / BURST_INTERVAL_MS);
      console.log(`\n──── RÁFAGA: ${total} comandos, 1 cada ${BURST_INTERVAL_MS}ms durante ${BURST_SECONDS}s ────`);
      const t0 = Date.now();
      for (let i = 1; i <= total; i++) {
        const tick = Date.now();
        const r = await callCommand(token, i);
        results.push(r);
        console.log(`  #${String(i).padStart(2)} t=${((tick - t0) / 1000).toFixed(1).padStart(5)}s  HTTP ${r.http}  ${r.status}/${r.reason ?? '-'}  written=${r.written} confirmed=${r.confirmed}  (${r.ms}ms)`);
        const elapsed = Date.now() - tick;
        if (i < total && elapsed < BURST_INTERVAL_MS) await sleep(BURST_INTERVAL_MS - elapsed);
      }
    }

    // ── 7. verificación final: nada latente ──
    const outEnd = await adapter.readBufferElement(OUT_EL);
    const inEnd = await adapter.readBufferElement(IN_EL);
    console.log(`\n${now()}  FINAL   INT_OUT[0]=${outEnd.value} ${bits(outEnd.value)}   INT_IN[0]=${inEnd.value} ${bits(inEnd.value)}`);
    console.log(`         bit latente: ${Number(outEnd.value) === 0 ? 'NO (INT_OUT[0]=0, reposo) ✅' : `SÍ ⚠️ INT_OUT[0]=${outEnd.value}`}`);

    // ── 8. resumen ──
    if (results.length) {
      const byStatus = results.reduce<Record<string, number>>((a, r) => { const k = `${r.http} ${r.status}/${r.reason ?? '-'}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
      console.log(`\n════════ RESUMEN (${results.length} llamadas) ════════`);
      for (const [k, v] of Object.entries(byStatus)) console.log(`  ${v}×  ${k}`);
      const ms = results.map((r) => r.ms).sort((a, b) => a - b);
      console.log(`  duración por llamada: min=${ms[0]}ms  mediana=${ms[Math.floor(ms.length / 2)]}ms  max=${ms[ms.length - 1]}ms`);
      console.log(`  JSON: ${JSON.stringify(results)}`);
    }
  } finally {
    await app.close().catch(() => undefined);
    console.log(`${now()}  instancia de prueba cerrada.`);
  }
  process.exit(0);
}

main().catch((err) => { console.error('fieldtest-valve-run falló:', err instanceof Error ? err.stack : err); process.exit(1); });
