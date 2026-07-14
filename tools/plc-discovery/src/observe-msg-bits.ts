/**
 * Observación temporal de SOLO LECTURA de los bits DN/ER/TO de la instrucción MSG.
 * FASE 0.2, arreglo 2.
 *
 * Pregunta que responde: ¿el valor instantáneo de DN sirve para derivar
 * connectionStatus, o DN parpadea (bit transitorio de Rockwell) y hace falta un
 * agregador con ventana temporal?
 *
 * Muestrea DN/ER/TO de 3 sitios (rico/estándar/mínimo) cada ~200 ms durante 60 s.
 * Reutiliza la fachada ReadOnlySession (no expone write/call/subscription). Solo Read.
 *
 * Ejecutar: npx tsx src/observe-msg-bits.ts
 */
import { AttributeIds } from 'node-opcua';
import { loadConfig } from './config';
import { connectReadOnly } from './lib/client';
import { browseNodes, normalizeName } from './lib/browse';
import { statusCodeToJson } from './lib/values';
import { saveArtifact } from './lib/artifacts';
import { sleep } from './lib/throttle';
import { ReadOnlySession } from './lib/readonly-session';

const SITES = ['MONTEBELLO', 'VORAGINE', 'QUIJOTE']; // rico / estándar / mínimo
const DURATION_MS = Number(process.env.OBS_DURATION_MS) || 60_000;
const INTERVAL_MS = Number(process.env.OBS_INTERVAL_MS) || 200;

async function resolveControllerTags(session: ReadOnlySession, rootPath: string[], throttleMs: number): Promise<string> {
  let current = 'i=85';
  for (const seg of rootPath) {
    const [o] = await browseNodes(session, [current], throttleMs);
    const t = o.references.find((r) => normalizeName(r.browseName.name ?? '') === normalizeName(seg));
    if (!t) throw new Error(`No se resolvió "${seg}"`);
    current = t.nodeId.toString();
  }
  return current;
}

interface Bit { site: string; member: 'DN' | 'ER' | 'TO'; nodeId: string; series: boolean[] }

function analyze(series: boolean[], intervalMs: number) {
  const n = series.length;
  const high = series.filter(Boolean).length;
  let transitions = 0;
  let maxLowRun = 0;
  let curLowRun = 0;
  let maxHighRun = 0;
  let curHighRun = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && series[i] !== series[i - 1]) transitions++;
    if (series[i]) { curHighRun++; curLowRun = 0; } else { curLowRun++; curHighRun = 0; }
    maxLowRun = Math.max(maxLowRun, curLowRun);
    maxHighRun = Math.max(maxHighRun, curHighRun);
  }
  return {
    samples: n,
    dutyCycleHigh: n ? Number((high / n).toFixed(3)) : 0,
    transitions,
    maxLowRunMs: maxLowRun * intervalMs,
    maxHighRunMs: maxHighRun * intervalMs,
    everHigh: high > 0,
    everLow: high < n,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const conn = await connectReadOnly(config);
  try {
    const root = await resolveControllerTags(conn.session, config.rootPath, config.throttleMs);
    const [top] = await browseNodes(conn.session, [root], config.throttleMs);

    const bits: Bit[] = [];
    for (const site of SITES) {
      const msgReads = top.references.filter(
        (r) => (r.browseName.name ?? '').toUpperCase().includes(site) && (r.browseName.name ?? '').toUpperCase().startsWith('MSG_READ'),
      );
      const primary = msgReads.find((r) => !/_INT_/i.test(r.browseName.name ?? '')) ?? msgReads[0];
      if (!primary) throw new Error(`Sin MSG_READ para ${site}`);
      const [kids] = await browseNodes(conn.session, [primary.nodeId.toString()], config.throttleMs);
      for (const member of ['DN', 'ER', 'TO'] as const) {
        const k = kids.references.find((r) => (r.browseName.name ?? '').toUpperCase() === member);
        if (!k) throw new Error(`Sin ${member} en ${primary.browseName.name}`);
        bits.push({ site, member, nodeId: k.nodeId.toString(), series: [] });
      }
    }

    console.log(`Observando ${bits.length} bits (${SITES.join(', ')}) cada ${INTERVAL_MS}ms durante ${DURATION_MS / 1000}s…`);
    const readItems = bits.map((b) => ({ nodeId: b.nodeId, attributeId: AttributeIds.Value }));
    const start = Date.now();
    const tickTimestamps: number[] = [];
    let badReads = 0;

    while (Date.now() - start < DURATION_MS) {
      const tickStart = Date.now();
      const dvs = await conn.session.read(readItems);
      tickTimestamps.push(tickStart - start);
      dvs.forEach((dv, i) => {
        const good = statusCodeToJson(dv.statusCode).severity === 'Good';
        if (!good) badReads++;
        bits[i].series.push(good ? dv.value?.value === true : false);
      });
      const elapsed = Date.now() - tickStart;
      if (elapsed < INTERVAL_MS) await sleep(INTERVAL_MS - elapsed);
    }

    // Intervalo real medio (para saber si 200ms fue lo bastante fino).
    const deltas: number[] = [];
    for (let i = 1; i < tickTimestamps.length; i++) deltas.push(tickTimestamps[i] - tickTimestamps[i - 1]);
    const avgInterval = deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : 0;

    const perSite = SITES.map((site) => {
      const dn = bits.find((b) => b.site === site && b.member === 'DN')!;
      const er = bits.find((b) => b.site === site && b.member === 'ER')!;
      const to = bits.find((b) => b.site === site && b.member === 'TO')!;
      return {
        site,
        DN: analyze(dn.series, avgInterval || INTERVAL_MS),
        ER: analyze(er.series, avgInterval || INTERVAL_MS),
        TO: analyze(to.series, avgInterval || INTERVAL_MS),
      };
    });

    const artifact = {
      observedAt: new Date().toISOString(),
      server: config.endpointUrl,
      durationMs: DURATION_MS,
      requestedIntervalMs: INTERVAL_MS,
      actualAvgIntervalMs: avgInterval,
      totalTicks: tickTimestamps.length,
      badReads,
      perSite,
      rawSeries: bits.map((b) => ({ site: b.site, member: b.member, series: b.series.map((v) => (v ? 1 : 0)) })),
    };
    saveArtifact(config.outputDir, 'msg_bits_observation.json', artifact);

    console.log(`\nIntervalo real medio: ${avgInterval}ms | ticks: ${tickTimestamps.length} | badReads: ${badReads}\n`);
    for (const s of perSite) {
      console.log(`${s.site.padEnd(12)} DN: duty=${s.DN.dutyCycleHigh} trans=${s.DN.transitions} maxLow=${s.DN.maxLowRunMs}ms | ER ever=${s.ER.everHigh} | TO ever=${s.TO.everHigh}`);
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
