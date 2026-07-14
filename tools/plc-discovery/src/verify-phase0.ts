/**
 * Verificación puntual de SOLO LECTURA para FASE 0.1 (hallazgos 3 y 5).
 *
 * H3: confirmar la topología real de los sitios atípicos (san-antonio, quijote)
 *     — ¿realmente tienen un único buffer, o la captura previa quedó truncada?
 * H5: leer los bits DN/ER/TO del MSG_READ primario de los 12 sitios para decidir
 *     confidence real de connection (confirmed si responde Good, si no inferred).
 *
 * Reutiliza el cliente de solo lectura del tool (fachada ReadOnlySession: no expone
 * write/call/subscription). Nunca escribe, nunca llama métodos.
 * Salida: output/phase0_verification.json (gitignored) — se transcribe a docs/.
 */
import { AttributeIds } from 'node-opcua';
import { loadConfig } from './config';
import { connectReadOnly } from './lib/client';
import { browseNodes, normalizeName } from './lib/browse';
import { readInBatches } from './lib/batching';
import { statusCodeToJson, toJsonValue } from './lib/values';
import { saveArtifact } from './lib/artifacts';
import { ReadOnlySession } from './lib/readonly-session';

const SITES = ['ALTO_MANGOS','CAMPOALEGRE','CARBONERO','CASCAJAL','KM18','MANGOS','MONTEBELLO','PICHINDE','QUIJOTE','SAN_ANTONO','SAN_ANTONIO','SIRENA','SOLEDAD','VORAGINE'];
function siteOf(bn: string): string | null {
  const u = bn.toUpperCase();
  const m = SITES.filter((s) => u.includes(s)).sort((a, b) => b.length - a.length)[0];
  if (!m) return null;
  if (m === 'SAN_ANTONO') return 'SAN_ANTONIO';
  if (m === 'MANGOS') return 'ALTO_MANGOS';
  return m;
}
function channelOf(bn: string): string | null {
  const n = bn.toUpperCase();
  if (/^LOCAL:\d+:[CIO]$/.test(n)) return 'localIO';
  if (n.startsWith('MSG_READ')) return 'msgRead';
  if (n.startsWith('MSG_WRITE')) return 'msgWrite';
  if (n.includes('PRUEBA') || n.includes('TEST')) return null;
  if (n.startsWith('BIT')) return 'bitIn';
  if (/_OUT_|_OUT$/.test(n)) return n.includes('REAL') || n.startsWith('DATOS') ? 'realOut' : 'intOut';
  if (/_IN_|_IN$|^REAL_|^DATOS_/.test(n)) return n.startsWith('INT') || n.includes('_INT') || n.includes('ENTEROS') ? 'intIn' : 'realIn';
  return null;
}

const ORDER = ['VORAGINE','SOLEDAD','MONTEBELLO','CASCAJAL','KM18','ALTO_MANGOS','CAMPOALEGRE','PICHINDE','CARBONERO','SIRENA','SAN_ANTONIO','QUIJOTE'];

async function resolveControllerTags(session: ReadOnlySession, rootPath: string[], throttleMs: number): Promise<string> {
  let current = 'i=85';
  for (const seg of rootPath) {
    const [o] = await browseNodes(session, [current], throttleMs);
    const t = o.references.find((r) => normalizeName(r.browseName.name ?? '') === normalizeName(seg));
    if (!t) throw new Error(`No se resolvió el segmento "${seg}"`);
    current = t.nodeId.toString();
  }
  return current;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const conn = await connectReadOnly(config);
  try {
    const namespaces = await conn.session.readNamespaceArray();
    const root = await resolveControllerTags(conn.session, config.rootPath, config.throttleMs);

    // Browse de los buffers de nivel superior (fresco, no desde caché).
    const [top] = await browseNodes(conn.session, [root], config.throttleMs);
    const topBuffers = top.references.map((r) => ({
      name: r.browseName.name ?? '',
      nodeId: r.nodeId.toString(),
      site: siteOf(r.browseName.name ?? ''),
      channel: channelOf(r.browseName.name ?? ''),
    }));

    // H3: topología por sitio.
    const topology: Record<string, Record<string, string[]>> = {};
    for (const b of topBuffers) {
      if (!b.site || !b.channel || b.channel === 'localIO') continue;
      (topology[b.site] ||= {});
      (topology[b.site][b.channel] ||= []).push(b.name);
    }

    // H5: para cada sitio, MSG_READ primario (no _INT_) → hijos DN/ER/TO → leer.
    const connChecks: Array<{
      site: string;
      msgRead: string | null;
      members: Record<string, { nodeId: string; status: string; value: unknown } | null>;
      confidence: 'confirmed' | 'inferred';
    }> = [];

    for (const site of ORDER) {
      const msgReads = topBuffers.filter((b) => b.site === site && b.channel === 'msgRead');
      const primary = msgReads.find((b) => !/_INT_/i.test(b.name)) ?? msgReads[0] ?? null;
      const entry = {
        site,
        msgRead: primary ? primary.name : null,
        members: {} as Record<string, { nodeId: string; status: string; value: unknown } | null>,
        confidence: 'inferred' as 'confirmed' | 'inferred',
      };
      if (primary) {
        const [kids] = await browseNodes(conn.session, [primary.nodeId], config.throttleMs);
        const memberIds: Record<string, string> = {};
        for (const name of ['DN', 'ER', 'TO']) {
          const k = kids.references.find((r) => (r.browseName.name ?? '').toUpperCase() === name);
          entry.members[name] = k ? { nodeId: k.nodeId.toString(), status: 'pending', value: null } : null;
          if (k) memberIds[name] = k.nodeId.toString();
        }
        const ids = Object.entries(memberIds);
        if (ids.length) {
          const dvs = await readInBatches(
            conn.session,
            ids.map(([, nodeId]) => ({ nodeId, attributeId: AttributeIds.Value })),
            config.readBatch,
            config.throttleMs,
            `conn-${site}`,
          );
          ids.forEach(([name], i) => {
            const sc = statusCodeToJson(dvs[i].statusCode);
            entry.members[name] = { nodeId: memberIds[name], status: sc.name, value: dvs[i].value ? toJsonValue(dvs[i].value.value) : null };
          });
          // confirmed solo si los 3 miembros respondieron Good.
          const allGood = ['DN', 'ER', 'TO'].every((m) => entry.members[m] && entry.members[m]!.status === 'Good');
          entry.confidence = allGood ? 'confirmed' : 'inferred';
        }
      }
      connChecks.push(entry);
    }

    const artifact = {
      verifiedAt: new Date().toISOString(),
      server: config.endpointUrl,
      namespaces,
      session: { securityMode: conn.securityMode, securityPolicy: conn.securityPolicy, identity: conn.identity },
      hallazgo3_topologia: {
        SAN_ANTONIO: topology['SAN_ANTONIO'] ?? {},
        QUIJOTE: topology['QUIJOTE'] ?? {},
        _todos: topology,
      },
      hallazgo5_connection: connChecks,
    };
    saveArtifact(config.outputDir, 'phase0_verification.json', artifact);

    console.log('\n=== H3 topología sitios atípicos ===');
    for (const s of ['SAN_ANTONIO', 'QUIJOTE']) {
      console.log(`  ${s}: ${JSON.stringify(topology[s] ?? {})}`);
    }
    console.log('\n=== H5 connection (DN/ER/TO leídos) ===');
    for (const c of connChecks) {
      const st = ['DN', 'ER', 'TO'].map((m) => `${m}=${c.members[m]?.status ?? '—'}`).join(' ');
      console.log(`  ${c.site.padEnd(12)} ${c.confidence.padEnd(9)} [${st}]  (${c.msgRead ?? 'sin MSG_READ'})`);
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
