/**
 * M4 (FASE 0.3, complemento decisivo). SOLO LECTURA.
 * ¿El SourceTimestamp de un buffer con VALOR ESTÁTICO igual avanza?
 *   - Si SÍ → SourceTimestamp distingue "conectado pero quieto" de "desconectado":
 *            es la mejor fuente de connectionStatus.
 *   - Si NO (timestamp congelado cuando el valor no cambia) → freshness de timestamp
 *            == freshness de valor, y los sitios estáticos están de hecho congelados.
 *
 * Compara un sitio activo (SOLEDAD), uno lento (MONTEBELLO) y uno estático (VORAGINE)
 * leyendo su realIn ~cada 1 s durante 30 s.
 */
import { AttributeIds } from 'node-opcua';
import { loadConfig } from './config';
import { connectReadOnly } from './lib/client';
import { browseNodes, normalizeName } from './lib/browse';
import { toJsonValue } from './lib/values';
import { saveArtifact } from './lib/artifacts';
import { sleep } from './lib/throttle';
import { ReadOnlySession } from './lib/readonly-session';

const TARGETS = ['REAL_IN_SOLEDAD', 'REAL_IN_MONTEBELLO', 'REAL_IN_VORAGINE'];
const DURATION_MS = 30_000;
const INTERVAL_MS = 1_000;

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

async function main(): Promise<void> {
  const config = loadConfig();
  const conn = await connectReadOnly(config);
  try {
    const root = await resolveRoot(conn.session, config.rootPath, config.throttleMs);
    const [top] = await browseNodes(conn.session, [root], config.throttleMs);
    const targets = TARGETS.map((name) => {
      const ref = top.references.find((r) => (r.browseName.name ?? '') === name);
      if (!ref) throw new Error(`No se encontró ${name}`);
      return { name, nodeId: ref.nodeId.toString(), tsSet: new Set<string>(), valueChanges: 0, prevValue: '', reads: 0 };
    });

    console.log(`M4: SourceTimestamp vs cambio de valor, ${TARGETS.join(', ')}, ${DURATION_MS / 1000}s`);
    const items = targets.map((t) => ({ nodeId: t.nodeId, attributeId: AttributeIds.Value }));
    const start = Date.now();
    while (Date.now() - start < DURATION_MS) {
      const t0 = Date.now();
      const dvs = await conn.session.read(items);
      dvs.forEach((dv, i) => {
        const t = targets[i];
        t.reads++;
        if (dv.sourceTimestamp) t.tsSet.add(dv.sourceTimestamp.toISOString());
        const v = JSON.stringify(dv.value ? toJsonValue(dv.value.value) : null);
        if (t.prevValue && v !== t.prevValue) t.valueChanges++;
        t.prevValue = v;
      });
      const el = Date.now() - t0;
      if (el < INTERVAL_MS) await sleep(INTERVAL_MS - el);
    }

    const result = targets.map((t) => ({
      buffer: t.name,
      reads: t.reads,
      distinctTimestamps: t.tsSet.size,
      valueChanges: t.valueChanges,
      timestampAdvancesWhileValueStatic: t.valueChanges === 0 && t.tsSet.size > 1,
    }));
    saveArtifact(config.outputDir, 'ts_freshness_observation.json', { observedAt: new Date().toISOString(), durationMs: DURATION_MS, result });

    console.log('');
    for (const r of result) {
      console.log(`  ${r.buffer.padEnd(20)} reads=${r.reads} distinctTs=${r.distinctTimestamps} valueChanges=${r.valueChanges} → tsAvanzaConValorEstatico=${r.timestampAdvancesWhileValueStatic}`);
    }
  } finally {
    await conn.session.close().catch(() => undefined);
    await conn.disconnect();
  }
}

main().catch((e) => { console.error(`FALLÓ: ${e instanceof Error ? e.message : e}`); process.exit(1); });
