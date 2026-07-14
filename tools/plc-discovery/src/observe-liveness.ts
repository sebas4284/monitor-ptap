/**
 * Observación de viabilidad de connectionStatus (FASE 0.3). SOLO LECTURA.
 * Fachada ReadOnlySession: nunca Write, nunca Call, nunca Subscription.
 *
 * Tres mediciones en una corrida para distinguir:
 *   H-a) Los MSG pulsan más rápido de lo observable.
 *   H-b) Los MSG no se están ejecutando.
 *   H-c) Optix sondea el PLC tan lento que el pulso es inobservable por OPC UA.
 *
 * M1 (60 s): EN/EW/ST/DN/ER/TO del MSG_READ primario de 3 sitios → ¿MSG vivos?
 * M2 (180 s): arrays realIn/intIn de los 12 sitios cada ~2 s → ¿los datos se mueven?
 *             + búsqueda de contadores monotónicos (heartbeat).
 * M3 (30 s): SourceTimestamp de un buffer activo leído a máxima frecuencia → techo
 *            de resolución temporal del servidor.
 *
 * Ejecutar: npx tsx src/observe-liveness.ts
 */
import { AttributeIds } from 'node-opcua';
import type { DataValue } from 'node-opcua';
import { loadConfig } from './config';
import { connectReadOnly } from './lib/client';
import { browseNodes, normalizeName } from './lib/browse';
import { statusCodeToJson, toJsonValue } from './lib/values';
import { saveArtifact } from './lib/artifacts';
import { sleep } from './lib/throttle';
import { ReadOnlySession } from './lib/readonly-session';

const M1_SITES = ['MONTEBELLO', 'VORAGINE', 'QUIJOTE'];
const M1_MEMBERS = ['EN', 'EW', 'ST', 'DN', 'ER', 'TO'] as const;
const M1_DURATION_MS = Number(process.env.M1_MS) || 60_000;
const M1_INTERVAL_MS = 200;

const M2_DURATION_MS = Number(process.env.M2_MS) || 180_000;
const M2_INTERVAL_MS = 2_000;

const M3_DURATION_MS = Number(process.env.M3_MS) || 30_000;

const ALL_SITES = ['VORAGINE','SOLEDAD','MONTEBELLO','CASCAJAL','KM18','ALTO_MANGOS','CAMPOALEGRE','PICHINDE','CARBONERO','SIRENA','SAN_ANTONIO','QUIJOTE'];

function siteOf(bn: string): string | null {
  const S = ['ALTO_MANGOS','CAMPOALEGRE','CARBONERO','CASCAJAL','KM18','MANGOS','MONTEBELLO','PICHINDE','QUIJOTE','SAN_ANTONO','SAN_ANTONIO','SIRENA','SOLEDAD','VORAGINE'];
  const u = bn.toUpperCase();
  const m = S.filter((s) => u.includes(s)).sort((a, b) => b.length - a.length)[0];
  if (!m) return null;
  if (m === 'SAN_ANTONO') return 'SAN_ANTONIO';
  if (m === 'MANGOS') return 'ALTO_MANGOS';
  return m;
}
function isRealIn(bn: string): boolean {
  const n = bn.toUpperCase();
  if (/_OUT_|_OUT$/.test(n) || n.startsWith('MSG') || n.startsWith('BIT')) return false;
  return /_IN_|_IN$|^REAL_|^DATOS_/.test(n) && !(n.startsWith('INT') || n.includes('_INT') || n.includes('ENTEROS'));
}
function isIntIn(bn: string): boolean {
  const n = bn.toUpperCase();
  if (/_OUT_|_OUT$/.test(n) || n.startsWith('MSG') || n.includes('PRUEBA')) return false;
  return n.startsWith('INT_IN') || (n.startsWith('INT') && /_IN_/.test(n));
}

async function resolveRoot(session: ReadOnlySession, rootPath: string[], throttleMs: number): Promise<string> {
  let current = 'i=85';
  for (const seg of rootPath) {
    const [o] = await browseNodes(session, [current], throttleMs);
    const t = o.references.find((r) => normalizeName(r.browseName.name ?? '') === normalizeName(seg));
    if (!t) throw new Error(`No se resolvió "${seg}"`);
    current = t.nodeId.toString();
  }
  return current;
}

function analyzeBits(series: boolean[]) {
  const n = series.length;
  const high = series.filter(Boolean).length;
  let transitions = 0;
  for (let i = 1; i < n; i++) if (series[i] !== series[i - 1]) transitions++;
  return { samples: n, dutyCycleHigh: n ? Number((high / n).toFixed(3)) : 0, transitions, everHigh: high > 0 };
}

interface IndexStat {
  changed: boolean;
  changeCount: number;
  prev: number | null;
  first: number | null;
  last: number | null;
  nonDecreasing: boolean;
  increased: boolean;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const conn = await connectReadOnly(config);
  const artifact: Record<string, unknown> = { observedAt: new Date().toISOString(), server: config.endpointUrl };
  try {
    const root = await resolveRoot(conn.session, config.rootPath, config.throttleMs);
    const [top] = await browseNodes(conn.session, [root], config.throttleMs);
    const topRefs = top.references.map((r) => ({ name: r.browseName.name ?? '', nodeId: r.nodeId.toString() }));

    // ── M1: bits del MSG ──────────────────────────────────────────────────────
    console.log(`M1: bits ${M1_MEMBERS.join('/')} de ${M1_SITES.join(',')} durante ${M1_DURATION_MS / 1000}s`);
    const m1bits: Array<{ site: string; member: string; nodeId: string; series: boolean[] }> = [];
    for (const site of M1_SITES) {
      const msgReads = topRefs.filter((r) => r.name.toUpperCase().includes(site) && r.name.toUpperCase().startsWith('MSG_READ'));
      const primary = msgReads.find((r) => !/_INT_/i.test(r.name)) ?? msgReads[0];
      if (!primary) continue;
      const [kids] = await browseNodes(conn.session, [primary.nodeId], config.throttleMs);
      for (const member of M1_MEMBERS) {
        const k = kids.references.find((r) => (r.browseName.name ?? '').toUpperCase() === member);
        if (k) m1bits.push({ site, member, nodeId: k.nodeId.toString(), series: [] });
      }
    }
    {
      const items = m1bits.map((b) => ({ nodeId: b.nodeId, attributeId: AttributeIds.Value }));
      const start = Date.now();
      while (Date.now() - start < M1_DURATION_MS) {
        const t0 = Date.now();
        const dvs = await conn.session.read(items);
        dvs.forEach((dv, i) => {
          const good = statusCodeToJson(dv.statusCode).severity === 'Good';
          m1bits[i].series.push(good ? dv.value?.value === true : false);
        });
        const el = Date.now() - t0;
        if (el < M1_INTERVAL_MS) await sleep(M1_INTERVAL_MS - el);
      }
    }
    artifact.measurement1 = M1_SITES.map((site) => {
      const out: Record<string, unknown> = { site };
      for (const member of M1_MEMBERS) {
        const b = m1bits.find((x) => x.site === site && x.member === member);
        out[member] = b ? analyzeBits(b.series) : null;
      }
      return out;
    });
    console.log('  M1 listo.');

    // ── M2: frescura de datos ─────────────────────────────────────────────────
    const dataBuffers = topRefs
      .filter((r) => (isRealIn(r.name) || isIntIn(r.name)) && siteOf(r.name))
      .map((r) => ({ site: siteOf(r.name)!, name: r.name, nodeId: r.nodeId, kind: isRealIn(r.name) ? 'realIn' : 'intIn' }));
    console.log(`M2: ${dataBuffers.length} buffers de datos, cada ${M2_INTERVAL_MS / 1000}s durante ${M2_DURATION_MS / 1000}s`);

    const stats = new Map<string, Map<number, IndexStat>>(); // nodeId → index → stat
    const badTicks = new Map<string, number>();
    const goodTicks = new Map<string, number>();
    const lastChangeTick = new Map<string, number>(); // por sitio
    const maxNoChangeGap = new Map<string, number>();
    for (const b of dataBuffers) { stats.set(b.nodeId, new Map()); badTicks.set(b.nodeId, 0); goodTicks.set(b.nodeId, 0); }
    for (const s of ALL_SITES) { lastChangeTick.set(s, -1); maxNoChangeGap.set(s, 0); }

    {
      const items = dataBuffers.map((b) => ({ nodeId: b.nodeId, attributeId: AttributeIds.Value }));
      const start = Date.now();
      let tick = 0;
      const siteChangedThisTick = new Set<string>();
      while (Date.now() - start < M2_DURATION_MS) {
        const t0 = Date.now();
        siteChangedThisTick.clear();
        let dvs: DataValue[] = [];
        try {
          dvs = await conn.session.read(items);
        } catch {
          dvs = [];
        }
        dvs.forEach((dv, i) => {
          const buf = dataBuffers[i];
          const good = dv && statusCodeToJson(dv.statusCode).severity === 'Good';
          if (!good || !dv.value) { badTicks.set(buf.nodeId, (badTicks.get(buf.nodeId) ?? 0) + 1); return; }
          goodTicks.set(buf.nodeId, (goodTicks.get(buf.nodeId) ?? 0) + 1);
          const arr = toJsonValue(dv.value.value);
          if (!Array.isArray(arr)) return;
          const idxMap = stats.get(buf.nodeId)!;
          arr.forEach((raw, idx) => {
            const v = typeof raw === 'number' ? raw : NaN;
            let st = idxMap.get(idx);
            if (!st) { st = { changed: false, changeCount: 0, prev: null, first: v, last: v, nonDecreasing: true, increased: false }; idxMap.set(idx, st); }
            if (st.prev !== null && v !== st.prev) {
              st.changed = true; st.changeCount++;
              siteChangedThisTick.add(buf.site);
              if (v < st.prev) st.nonDecreasing = false;
              if (v > st.prev) st.increased = true;
            }
            st.prev = v; st.last = v;
          });
        });
        // gaps por sitio
        for (const s of ALL_SITES) {
          if (siteChangedThisTick.has(s)) lastChangeTick.set(s, tick);
          const gap = tick - (lastChangeTick.get(s) ?? -1);
          if (gap > (maxNoChangeGap.get(s) ?? 0)) maxNoChangeGap.set(s, gap);
        }
        tick++;
        if (tick % 15 === 0) console.log(`  M2 tick ${tick} (${Math.round((Date.now() - start) / 1000)}s)`);
        const el = Date.now() - t0;
        if (el < M2_INTERVAL_MS) await sleep(M2_INTERVAL_MS - el);
      }

      const perSite = ALL_SITES.map((site) => {
        const bufs = dataBuffers.filter((b) => b.site === site);
        let changedIdx = 0, totalChanges = 0, indicesSeen = 0;
        const counters: Array<{ buffer: string; index: number; first: number | null; last: number | null }> = [];
        for (const b of bufs) {
          const idxMap = stats.get(b.nodeId)!;
          for (const [idx, st] of idxMap) {
            indicesSeen++;
            if (st.changed) changedIdx++;
            totalChanges += st.changeCount;
            if (st.nonDecreasing && st.increased) counters.push({ buffer: b.name, index: idx, first: st.first, last: st.last });
          }
        }
        const bad = bufs.reduce((a, b) => a + (badTicks.get(b.nodeId) ?? 0), 0);
        const good = bufs.reduce((a, b) => a + (goodTicks.get(b.nodeId) ?? 0), 0);
        return {
          site,
          buffers: bufs.map((b) => b.name),
          indicesSeen,
          changedIndices: changedIdx,
          totalChanges,
          monotonicCounters: counters,
          maxNoChangeGapTicks: maxNoChangeGap.get(site) ?? 0,
          maxNoChangeGapMs: (maxNoChangeGap.get(site) ?? 0) * M2_INTERVAL_MS,
          fullyStatic: changedIdx === 0,
          goodReads: good,
          badReads: bad,
        };
      });
      artifact.measurement2 = { intervalMs: M2_INTERVAL_MS, ticks: tick, perSite };
      console.log('  M2 listo.');

      // Elegir un buffer activo para M3.
      let m3buf = dataBuffers.find((b) => {
        const idxMap = stats.get(b.nodeId)!;
        return [...idxMap.values()].some((st) => st.changed);
      });
      if (!m3buf) m3buf = dataBuffers.find((b) => b.name.toUpperCase() === 'REAL_IN_VORAGINE') ?? dataBuffers[0];

      // ── M3: techo de SourceTimestamp ────────────────────────────────────────
      console.log(`M3: SourceTimestamp de ${m3buf.name} a máxima frecuencia durante ${M3_DURATION_MS / 1000}s`);
      const tsList: number[] = [];
      let reads = 0, sameTs = 0;
      const startM3 = Date.now();
      let lastTs = -1;
      while (Date.now() - startM3 < M3_DURATION_MS) {
        const [dv] = await conn.session.read([{ nodeId: m3buf.nodeId, attributeId: AttributeIds.Value }]);
        reads++;
        const ts = dv.sourceTimestamp ? dv.sourceTimestamp.getTime() : -1;
        if (ts > 0) {
          if (ts === lastTs) sameTs++;
          else { tsList.push(ts); lastTs = ts; }
        }
      }
      const deltas: number[] = [];
      for (let i = 1; i < tsList.length; i++) deltas.push(tsList[i] - tsList[i - 1]);
      const minDelta = deltas.length ? Math.min(...deltas) : null;
      const meanDelta = deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null;
      artifact.measurement3 = {
        buffer: m3buf.name,
        nodeId: m3buf.nodeId,
        totalReads: reads,
        distinctTimestamps: tsList.length,
        repeatedTimestampReads: sameTs,
        minDeltaMs: minDelta,
        meanDeltaMs: meanDelta,
        readsPerSecond: Number((reads / (M3_DURATION_MS / 1000)).toFixed(1)),
      };
      console.log(`  M3: ${reads} reads, ${tsList.length} timestamps distintos, minDelta=${minDelta}ms`);
    }

    saveArtifact(config.outputDir, 'liveness_observation.json', artifact);
    console.log('\n=== RESUMEN ===');
    console.log(JSON.stringify({ m1: artifact.measurement1, m3: artifact.measurement3 }, null, 1));
    const m2 = artifact.measurement2 as { perSite: Array<{ site: string; changedIndices: number; totalChanges: number; monotonicCounters: unknown[]; maxNoChangeGapMs: number; fullyStatic: boolean; badReads: number }> };
    for (const s of m2.perSite) {
      console.log(`M2 ${s.site.padEnd(12)} changed=${s.changedIndices} total=${s.totalChanges} counters=${s.monotonicCounters.length} maxGap=${s.maxNoChangeGapMs}ms static=${s.fullyStatic} bad=${s.badReads}`);
    }
  } finally {
    await conn.session.close().catch(() => undefined);
    await conn.disconnect();
  }
}

main().catch((e) => {
  console.error(`FALLÓ: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
