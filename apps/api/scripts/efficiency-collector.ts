/**
 * COLECTOR DE EFICIENCIA — auditoría continua del backend PTAP.
 *
 * Recolecta KPIs de forma PASIVA (solo lectura) y calcula un "Efficiency Score" por zona,
 * adaptado a este backend de TIEMPO REAL (push por Socket.IO, cache RAM, telemetría no
 * persistida): pesan más el event-loop lag, la RAM (VM de 2 GB), la latencia OPC source→emit
 * y el fan-out, y menos el SQL. Base para un panel/tendencias.
 *
 * Fuentes (todas vía SSH a la VM — el backend escucha en 127.0.0.1:4000, cerrado a Internet):
 *   - GET /metrics            (Prometheus: RSS, event-loop lag, heap, GC, CPU, FDs + 9 métricas OPC)
 *   - GET /api/health/opc     (estado del puente, contadores)
 *   - pm2 jlist               (RSS/CPU/reinicios/uptime del proceso)
 *   - MySQL (solo lectura)    (tamaños de tabla, COUNT, EXPLAIN de las queries señaladas)
 *   - curl -w time_total      (latencia de endpoints públicos; peticiones sueltas, como un health-check)
 *
 * Uso:  EFF_SSH=ptap npx tsx scripts/efficiency-collector.ts [--json]
 *   EFF_SSH        alias SSH de la VM (default: ptap)
 *   EFF_ENV_PATH   ruta del .env en la VM (default: ~/monitor-ptap/.env) — de ahí lee el token de /metrics
 *   EFF_DB_CNF     defaults-file de MySQL en la VM (default: ~/.ptapdb.cnf)
 *   --json         imprime SOLO el bloque JSON (para pipelines/tendencias)
 *
 * NO modifica nada: ni el backend, ni la BD (solo SELECT/EXPLAIN), ni añade carga sostenida.
 */
import { execFileSync } from 'node:child_process';

const SSH = process.env.EFF_SSH ?? 'ptap';
const ENV_PATH = process.env.EFF_ENV_PATH ?? '~/monitor-ptap/.env';
const DB_CNF = process.env.EFF_DB_CNF ?? '~/.ptapdb.cnf';
const JSON_ONLY = process.argv.includes('--json');

const log = (...a: unknown[]): void => { if (!JSON_ONLY) console.log(...a); };

/** Ejecuta un comando remoto por SSH y devuelve stdout (o null si falla). Solo lectura. */
function ssh(remoteCmd: string, timeoutMs = 25000): string | null {
  try {
    return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=15`, SSH, remoteCmd], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

// ── parsing de texto Prometheus ────────────────────────────────────────────────
type PromSample = { labels: Record<string, string>; value: number };
function parseProm(text: string): Map<string, PromSample[]> {
  const out = new Map<string, PromSample[]>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([0-9eE+\-.]+)$/.exec(line.trim());
    if (!m) continue;
    const [, name, , labelStr, valStr] = m;
    const labels: Record<string, string> = {};
    if (labelStr) {
      for (const pair of labelStr.split(',')) {
        const eq = pair.indexOf('=');
        if (eq > 0) labels[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim().replace(/^"|"$/g, '');
      }
    }
    const value = Number(valStr);
    if (!out.has(name)) out.set(name, []);
    out.get(name)!.push({ labels, value });
  }
  return out;
}
const one = (p: Map<string, PromSample[]>, name: string): number | null => {
  const s = p.get(name);
  return s && s.length ? s[0].value : null;
};
const sum = (p: Map<string, PromSample[]>, name: string): number =>
  (p.get(name) ?? []).reduce((a, s) => a + s.value, 0);

/** p95 aproximado de un histograma Prometheus, agregando buckets de todas las labels (plantId). */
function histoP95(p: Map<string, PromSample[]>, base: string): number | null {
  const buckets = p.get(`${base}_bucket`);
  const count = sum(p, `${base}_count`);
  if (!buckets || !buckets.length || count === 0) return null;
  const byLe = new Map<number, number>();
  for (const b of buckets) {
    const le = b.labels.le === '+Inf' ? Infinity : Number(b.labels.le);
    byLe.set(le, (byLe.get(le) ?? 0) + b.value);
  }
  const les = [...byLe.keys()].sort((a, b) => a - b);
  const target = 0.95 * count;
  for (const le of les) if ((byLe.get(le) ?? 0) >= target) return le === Infinity ? les[les.length - 2] ?? null : le;
  return null;
}

// ── scoring por bandas (0-100) ──────────────────────────────────────────────────
type Band = [max: number, score: number];
function band(value: number | null, bands: Band[], nullScore = 60): number {
  if (value === null || Number.isNaN(value)) return nullScore;
  for (const [max, score] of bands) if (value <= max) return score;
  return bands[bands.length - 1][1];
}
const clampScore = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
function statusOf(score: number): string {
  if (score >= 90) return '🟢 Óptimo';
  if (score >= 70) return '🟡 Mejorable';
  if (score >= 50) return '🟠 Requiere optimización';
  return '🔴 Crítico';
}

const RSS_RESTART_MB = 600; // max_memory_restart de pm2 (ecosystem.config.js)

async function main(): Promise<void> {
  log('\n══════════ COLECTOR DE EFICIENCIA — Backend PTAP ══════════');
  log(`VM: ssh ${SSH}  ·  ${new Date().toISOString()}\n`);

  // 1) /metrics (token leído del .env EN la VM; nunca sale de allí)
  const metricsText = ssh(
    `T=$(grep -E "^METRICS_AUTH_TOKEN=" ${ENV_PATH} | head -1 | cut -d= -f2- | tr -d '"'); ` +
      `curl -s -H "Authorization: Bearer $T" http://127.0.0.1:4000/metrics`,
  );
  const prom = metricsText ? parseProm(metricsText) : null;

  // 2) /api/health/opc (público)
  const healthRaw = ssh(`curl -s http://127.0.0.1:4000/api/health/opc`);
  let health: Record<string, unknown> | null = null;
  try { health = healthRaw ? (JSON.parse(healthRaw) as Record<string, unknown>) : null; } catch { /* 503 body u otro */ }

  // 3) pm2 jlist
  const pm2Raw = ssh(`pm2 jlist 2>/dev/null`);
  let pm2: { rssMB: number | null; cpu: number | null; restarts: number | null; uptimeH: number | null } = {
    rssMB: null, cpu: null, restarts: null, uptimeH: null,
  };
  try {
    const arr = pm2Raw ? (JSON.parse(pm2Raw) as Array<Record<string, any>>) : [];
    const proc = arr.find((x) => x?.name === 'ptap-api') ?? arr[0];
    if (proc) {
      pm2 = {
        rssMB: proc.monit?.memory ? Math.round(proc.monit.memory / 1048576) : null,
        cpu: typeof proc.monit?.cpu === 'number' ? proc.monit.cpu : null,
        restarts: proc.pm2_env?.restart_time ?? null,
        uptimeH: proc.pm2_env?.pm_uptime ? Math.round((Date.now() - proc.pm2_env.pm_uptime) / 3600000) : null,
      };
    }
  } catch { /* pm2 ausente */ }

  // 4) MySQL (solo lectura): tamaños, counts y EXPLAIN de P2 (purga) y P6 (users ORDER BY)
  const mysql = (q: string): string | null =>
    ssh(`mysql --defaults-extra-file=${DB_CNF} ptapapp -N -e "${q.replace(/"/g, '\\"')}" 2>/dev/null`);
  const tableSizes = mysql(
    "SELECT table_name, ROUND((data_length+index_length)/1048576,2), table_rows " +
      "FROM information_schema.tables WHERE table_schema='ptapapp' ORDER BY 2 DESC",
  );
  const auditCount = Number((mysql('SELECT COUNT(*) FROM audit_log') ?? '').trim() || 'NaN');
  const explainUsers = mysql('EXPLAIN SELECT * FROM users ORDER BY created_at DESC LIMIT 50');
  const explainPurge = mysql(
    "EXPLAIN DELETE FROM audit_log WHERE event_type <> 'opc.route_probe' AND at < (NOW() - INTERVAL 90 DAY)",
  );
  const usersFilesort = /filesort/i.test(explainUsers ?? '');

  // 5) Latencia de endpoints públicos (peticiones sueltas, como un health-check — no es carga)
  const timeRaw = ssh(
    `for u in /api/health /api/health/db /api/health/opc; do ` +
      `printf "%s " "$u"; curl -s -o /dev/null -w "%{time_total}\\n" http://127.0.0.1:4000$u; done`,
  );
  const restTimes: Record<string, number> = {};
  for (const line of (timeRaw ?? '').trim().split('\n')) {
    const [u, t] = line.trim().split(/\s+/);
    if (u && t) restTimes[u] = Math.round(parseFloat(t) * 1000);
  }
  const restP = Object.values(restTimes);
  const restAvgMs = restP.length ? Math.round(restP.reduce((a, b) => a + b, 0) / restP.length) : null;

  // ── KPIs derivados ──
  const rssMB = pm2.rssMB ?? (prom ? Math.round((one(prom, 'process_resident_memory_bytes') ?? 0) / 1048576) : null);
  const lagP99Ms = prom ? Math.round((one(prom, 'nodejs_eventloop_lag_p99_seconds') ?? 0) * 1000) : null;
  const heapUsedMB = prom ? Math.round((one(prom, 'nodejs_heap_size_used_bytes') ?? 0) / 1048576) : null;
  const openFds = prom ? one(prom, 'process_open_fds') : null;
  const opcLatP95 = prom ? histoP95(prom, 'opc_subscription_latency_ms') : null;
  const good = prom ? sum(prom, 'opc_quality_good_total') : 0;
  const bad = prom ? sum(prom, 'opc_quality_bad_total') : 0;
  const goodRatio = good + bad > 0 ? good / (good + bad) : null;
  const reconnects = prom ? one(prom, 'opc_reconnects_total') : null;
  const deadLetter = prom ? one(prom, 'opc_dead_letter_total') : null;
  const parserErr = prom ? one(prom, 'opc_parser_errors_total') : null;
  const mappingErr = prom ? one(prom, 'opc_mapping_errors_total') : null;
  const cpuPct = pm2.cpu;

  // ── sub-scores (0-100) ──
  const s = {
    // OPC source→frame pesa menos: incluye el desfase de reloj PLC↔VM y la cadencia de publishing,
    // no solo procesamiento (la latencia real de entrega la mide el harness de Fase 6, ~20 ms).
    latency: clampScore(
      0.65 * band(restAvgMs, [[20, 100], [50, 92], [100, 82], [250, 68], [1000, 50]], 70) +
      0.35 * band(opcLatP95, [[250, 100], [500, 92], [1000, 82], [2500, 72], [5000, 55]], 70),
    ),
    cpuLag: clampScore(
      Math.min(
        band(lagP99Ms, [[10, 100], [50, 92], [100, 80], [250, 62], [1000, 45]], 70),
        band(cpuPct, [[20, 100], [50, 88], [80, 68], [100, 50]], 90),
      ),
    ),
    ram: band(rssMB, [[250, 100], [360, 90], [480, 78], [540, 62], [RSS_RESTART_MB, 50]], 70),
    realtime: clampScore(
      band(goodRatio === null ? null : (1 - goodRatio) * 100, [[1, 100], [5, 85], [10, 70], [100, 50]], 70) -
      (deadLetter && deadLetter > 0 ? 10 : 0) -
      (reconnects && reconnects > 5 ? 10 : 0),
    ),
    db: clampScore(100 - (usersFilesort ? 15 : 0) - (auditCount > 500000 ? 15 : auditCount > 100000 ? 8 : 0)),
    // Salud de errores por TASA, no por conteo absoluto: llenado del ring-buffer dead-letter
    // (acotado a 500) + proporción de mala calidad. Un dead-letter con señales unmapped/índices
    // que el PLC no entrega es acotado y no debe hundir el score (es dato, no caída en curso).
    errors: clampScore(
      100 - (deadLetter ? Math.min(30, (deadLetter / 500) * 100 * 0.5) : 0) -
      (goodRatio !== null ? (1 - goodRatio) * 100 * 0.5 : 0),
    ),
    cost: band(rssMB, [[300, 100], [450, 88], [540, 70], [RSS_RESTART_MB, 55]], 70), // headroom de la VM
  };

  const W = { latency: 0.25, cpuLag: 0.2, ram: 0.2, realtime: 0.15, db: 0.1, errors: 0.05, cost: 0.05 };
  const global = clampScore(
    s.latency * W.latency + s.cpuLag * W.cpuLag + s.ram * W.ram + s.realtime * W.realtime +
    s.db * W.db + s.errors * W.errors + s.cost * W.cost,
  );

  // ── score por zona (comparten proceso; se ponderan las sub-scores relevantes a cada zona) ──
  const zones: Array<{ zona: string; score: number; nota: string }> = [
    { zona: "C′ Tiempo real (Socket.IO+pipeline)", score: clampScore(0.45 * s.realtime + 0.3 * s.cpuLag + 0.25 * s.latency), nota: `OPC p95 ${opcLatP95 ?? '—'}ms · lag ${lagP99Ms ?? '—'}ms` },
    { zona: 'C Plantas/Snapshot (REST)', score: clampScore(0.6 * s.latency + 0.4 * s.cpuLag), nota: `REST ~${restAvgMs ?? '—'}ms (cache RAM)` },
    { zona: 'A Auth/Login', score: clampScore(0.5 * s.latency + 0.3 * s.ram + 0.2 * s.db), nota: 'argon2 en threadpool, rate-limited' },
    { zona: 'B Usuarios', score: clampScore(0.6 * s.db + 0.4 * s.latency), nota: usersFilesort ? 'ORDER BY created_at → filesort' : 'ok' },
    { zona: 'F Reportes', score: clampScore(0.5 * s.cpuLag + 0.5 * s.latency), nota: 'loadMapping() sin memoizar (P1)' },
    { zona: 'D/E/G/H (OPC obs/Comandos/Salud/Métricas)', score: clampScore(0.5 * s.cpuLag + 0.3 * s.ram + 0.2 * s.errors), nota: 'baja frecuencia' },
  ];

  // ── salida ──
  const result = {
    at: new Date().toISOString(),
    reachable: prom !== null,
    kpis: { rssMB, rssHeadroomPctOf600: rssMB !== null ? Math.round(((RSS_RESTART_MB - rssMB) / RSS_RESTART_MB) * 100) : null, lagP99Ms, heapUsedMB, openFds, cpuPct, opcLatP95Ms: opcLatP95, goodRatio: goodRatio !== null ? Math.round(goodRatio * 10000) / 100 : null, reconnects, deadLetter, parserErr, mappingErr, restTimesMs: restTimes, auditRows: Number.isNaN(auditCount) ? null : auditCount, pm2 },
    subScores: s,
    weights: W,
    globalScore: global,
    globalStatus: statusOf(global),
    zones,
    explains: { usersFilesort, explainUsers: (explainUsers ?? '').trim(), explainPurge: (explainPurge ?? '').trim(), tableSizes: (tableSizes ?? '').trim() },
  };

  if (!prom) {
    log('❌ No se pudo leer /metrics de la VM (¿VPN caída, SSH o token?). Se emite lo obtenido.');
  }

  log('KPIs de proceso (VM):');
  log(`  RSS ${rssMB ?? '—'} MB (headroom ${result.kpis.rssHeadroomPctOf600 ?? '—'}% de ${RSS_RESTART_MB}MB)  ·  event-loop lag p99 ${lagP99Ms ?? '—'} ms  ·  heap ${heapUsedMB ?? '—'} MB  ·  FDs ${openFds ?? '—'}  ·  CPU ${cpuPct ?? '—'}%`);
  log(`  reinicios pm2 ${pm2.restarts ?? '—'}  ·  uptime ~${pm2.uptimeH ?? '—'} h`);
  log('KPIs OPC / tiempo real:');
  log(`  latencia source→frame p95 ${opcLatP95 ?? '—'} ms  ·  calidad Good ${result.kpis.goodRatio ?? '—'}%  ·  reconexiones ${reconnects ?? '—'}  ·  dead-letter ${deadLetter ?? '—'}  ·  parser/mapping err ${parserErr ?? '—'}/${mappingErr ?? '—'}`);
  log(`  latencia REST ${JSON.stringify(restTimes)}`);
  log('BD:');
  log(`  filas audit_log ${result.kpis.auditRows ?? '—'}  ·  users ORDER BY created_at → ${usersFilesort ? 'FILESORT ⚠️' : 'ok'}`);

  log('\nEfficiency Score por zona:');
  log('  ' + 'Zona'.padEnd(44) + 'Score  Estado');
  for (const z of zones) log('  ' + z.zona.padEnd(44) + String(z.score).padEnd(7) + statusOf(z.score) + `   (${z.nota})`);
  log('  ' + '─'.repeat(70));
  log('  ' + 'GLOBAL'.padEnd(44) + String(global).padEnd(7) + statusOf(global));
  log('\nSub-scores: ' + JSON.stringify(s));

  console.log('\n--- JSON ---');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('efficiency-collector falló:', err);
  process.exit(1);
});
