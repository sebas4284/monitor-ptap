/**
 * Generador reproducible de config/opc_mapping.json.
 *
 * Fuente de datos: FIXTURES VERSIONADOS en apps/api/fixtures/plc-discovery/
 * (NUNCA tools/plc-discovery/output/, que está gitignored). Los fixtures son
 * evidencia congelada de topología, trackeada en git; se recapturan corriendo el
 * tool de discovery + build-fixtures (ver apps/api/fixtures/README.md).
 *   - nodes.json                    topología + nsUri de cada nodo
 *   - readings.json                 dataType y arrayLength de cada buffer
 *   - connection-verification.json  confidence real de connection (DN/ER/TO leídos)
 *
 * Reglas del contrato:
 *   - Las referencias a nodos NO llevan índice de namespace: { nsUri, identifier }.
 *   - Se omiten los canales que un sitio no tiene (nunca arrays vacíos).
 *   - displayNameProvisional siempre presente.
 *   - connection.confidence proviene de la verificación por lectura, no se asume.
 *   - MANGOS y ALTO_MANGOS se fusionan; SAN_ANTONO se normaliza a san-antonio.
 *   - El adaptador de Fase 1 DEBE resolver nsUri → índice (ver scripts/resolve-namespaces.ts)
 *     en cada conexión y reconexión; un nsUri no resuelto ⇒ BridgeStatus = Faulted.
 *
 * Idempotente: dos corridas consecutivas producen el mismo archivo byte a byte.
 * Ejecutar: npm run generate:mapping
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FIX_DIR = join(__dirname, '..', 'fixtures', 'plc-discovery');
const DEST = join(__dirname, '..', 'config', 'opc_mapping.json');

interface NodeRow {
  nodeId: string;
  nsUri: string;
  browseName: string;
  parentNodeId: string;
  depth: number;
  rootLabel: string;
}
interface NodesDoc { capturedAt: string; namespaces: string[]; nodes: NodeRow[] }
interface ReadingRow { nodeId: string; dataType: string | null; arrayLength: number | null }
interface ReadingsDoc { endpointUrl: string; readings: ReadingRow[] }
interface VerifyConn { site: string; confidence: 'confirmed' | 'inferred' }
interface VerifyDoc { verifiedAt: string; connections: VerifyConn[] }

interface NodeReference { nsUri: string; identifier: string }
interface BufferDescriptor { browseName: string; node: NodeReference; arrayLength: number | null; dataType: string | null }

const CHANNELS = ['realIn', 'realOut', 'intIn', 'intOut', 'bitIn', 'bitOut', 'msgRead', 'msgWrite'] as const;
type Channel = (typeof CHANNELS)[number];

const SITES = ['ALTO_MANGOS','CAMPOALEGRE','CARBONERO','CASCAJAL','KM18','MANGOS','MONTEBELLO','PICHINDE','QUIJOTE','SAN_ANTONO','SAN_ANTONIO','SIRENA','SOLEDAD','VORAGINE'];
const ORDER = ['VORAGINE','SOLEDAD','MONTEBELLO','CASCAJAL','KM18','ALTO_MANGOS','CAMPOALEGRE','PICHINDE','CARBONERO','SIRENA','SAN_ANTONIO','QUIJOTE'];
const SLUG: Record<string, string> = {
  VORAGINE: 'voragine', SOLEDAD: 'soledad', MONTEBELLO: 'montebello', CASCAJAL: 'cascajal',
  KM18: 'km18', ALTO_MANGOS: 'alto-los-mangos', CAMPOALEGRE: 'campoalegre', PICHINDE: 'pichinde',
  CARBONERO: 'carbonero', SIRENA: 'sirena', SAN_ANTONIO: 'san-antonio', QUIJOTE: 'quijote',
};
const DISPLAY: Record<string, string> = {
  VORAGINE: 'La Vorágine', SOLEDAD: 'Soledad', MONTEBELLO: 'Montebello', CASCAJAL: 'Cascajal',
  KM18: 'Km 18', ALTO_MANGOS: 'Alto de los Mangos', CAMPOALEGRE: 'Campoalegre', PICHINDE: 'Pichindé',
  CARBONERO: 'Carbonero', SIRENA: 'La Sirena', SAN_ANTONIO: 'San Antonio', QUIJOTE: 'El Quijote',
};
// Sitios cuya topología mínima fue verificada por browse (H3).
const TOPOLOGY_VERIFIED = new Set(['SAN_ANTONIO', 'QUIJOTE']);

function siteOf(bn: string): string | null {
  const u = bn.toUpperCase();
  const m = SITES.filter((s) => u.includes(s)).sort((a, b) => b.length - a.length)[0];
  if (!m) return null;
  if (m === 'SAN_ANTONO') return 'SAN_ANTONIO';
  if (m === 'MANGOS') return 'ALTO_MANGOS';
  return m;
}
function channelOf(bn: string): Channel | 'localIO' | null {
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

/** "ns=9;g=ABC..." → { nsUri, identifier: "g=ABC..." }, sin índice de namespace. */
function toNodeReference(nodeId: string, nsUri: string): NodeReference {
  const identifier = nodeId.replace(/^ns=\d+;/, '');
  if (/^ns=/.test(identifier)) {
    throw new Error(`identifier con ns= residual: ${nodeId}`);
  }
  return { nsUri, identifier };
}

function main(): void {
  const nodesDoc = JSON.parse(readFileSync(join(FIX_DIR, 'nodes.json'), 'utf8')) as NodesDoc;
  const readingsDoc = JSON.parse(readFileSync(join(FIX_DIR, 'readings.json'), 'utf8')) as ReadingsDoc;
  const verifyDoc = JSON.parse(readFileSync(join(FIX_DIR, 'connection-verification.json'), 'utf8')) as VerifyDoc;

  const readingByNodeId: Record<string, ReadingRow> = {};
  for (const r of readingsDoc.readings) readingByNodeId[r.nodeId] = r;
  const confidenceBySite: Record<string, 'confirmed' | 'inferred'> = {};
  for (const c of verifyDoc.connections) confidenceBySite[c.site] = c.confidence;

  function bufferDescriptor(node: NodeRow): BufferDescriptor {
    const rd = readingByNodeId[node.nodeId];
    return {
      browseName: node.browseName,
      node: toNodeReference(node.nodeId, node.nsUri),
      arrayLength: rd ? rd.arrayLength : null,
      dataType: rd ? rd.dataType : null,
    };
  }

  // Agrupar buffers de nivel superior por sitio y canal.
  const bySite: Record<string, Partial<Record<Channel, NodeRow[]>>> = {};
  const topLevel = nodesDoc.nodes.filter((n) => n.depth === 1 && n.rootLabel === 'ControllerTags');
  for (const t of topLevel) {
    const ch = channelOf(t.browseName);
    if (!ch || ch === 'localIO') continue;
    const s = siteOf(t.browseName);
    if (!s) continue;
    (bySite[s] ||= {});
    ((bySite[s][ch] ||= []) as NodeRow[]).push(t);
  }

  function connectionFor(site: string, msgReadNodes: NodeRow[] | undefined): Record<string, unknown> {
    const confidence = confidenceBySite[site] ?? 'inferred';
    if (!msgReadNodes || !msgReadNodes.length) {
      return { done: null, error: null, timeout: null, mappingStatus: 'unmapped', confidence: 'inferred' };
    }
    const primary = msgReadNodes.find((n) => !/_INT_/i.test(n.browseName)) ?? msgReadNodes[0];
    const kids = nodesDoc.nodes.filter((n) => n.parentNodeId === primary.nodeId);
    const memberRef = (name: string): NodeReference | null => {
      const k = kids.find((n) => n.browseName.toUpperCase() === name);
      return k ? toNodeReference(k.nodeId, k.nsUri) : null;
    };
    const done = memberRef('DN'), error = memberRef('ER'), timeout = memberRef('TO');
    const mapped = Boolean(done && error && timeout);
    return {
      sourceBuffer: primary.browseName,
      done,
      error,
      timeout,
      mappingStatus: mapped ? 'mapped' : 'unmapped',
      confidence,
    };
  }

  const plants = ORDER.map((site) => {
    const chans = bySite[site] ?? {};
    const opcBuffers: Record<string, BufferDescriptor[]> = {};
    for (const ch of CHANNELS) {
      const list = chans[ch];
      if (list && list.length) opcBuffers[ch] = list.map(bufferDescriptor); // omitir canales ausentes
    }
    const plant: Record<string, unknown> = {
      plantId: SLUG[site],
      displayName: DISPLAY[site],
      displayNameProvisional: true,
    };
    if (TOPOLOGY_VERIFIED.has(site)) plant.topologyVerified = true;
    plant.opcBuffers = opcBuffers;
    plant.connection = connectionFor(site, chans.msgRead);
    plant.signals = [];
    return plant;
  });

  const doc = {
    $schema: './opc_mapping.schema.json',
    version: '0.2.0',
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    generatedFrom: {
      source: 'apps/api/fixtures/plc-discovery/ (nodes.json, readings.json, connection-verification.json)',
      recaptureTool: 'tools/plc-discovery (etapas 00-02 + verify-phase0 + build-fixtures)',
      capturedAt: nodesDoc.capturedAt,
      verifiedAt: verifyDoc.verifiedAt,
      server: readingsDoc.endpointUrl,
      namespaces: nodesDoc.namespaces,
      connectionEvidence: `connection.confidence proviene de leer DN/ER/TO con StatusCode Good el ${verifyDoc.verifiedAt} (sesión Anonymous/None de solo lectura). Ver docs/PHASE0_VERIFICATION.md.`,
    },
    notes: [
      'Identidad canónica = plantId (slug). No usar nombres del frontend ni ptap-N.',
      'Las referencias a nodos usan { nsUri, identifier } SIN índice de namespace. El adaptador de Fase 1 DEBE resolver nsUri → índice vía ReadNamespaceArray en CADA conexión y reconexión (el índice de Optix puede cambiar entre reinicios), usando scripts/resolve-namespaces.ts.',
      'Si un nsUri del mapping NO está en el NamespaceArray del servidor: NamespaceNotFoundError ⇒ BridgeStatus = Faulted (NO Recovering: no se arregla reintentando). Prohibido fallback a ns=0 o a un índice previo.',
      'MANGOS y ALTO_MANGOS fusionados en alto-los-mangos (confirmado). SAN_ANTONO normalizado a san-antonio.',
      'Sin export L5X: TODA señal de proceso está unmapped (signals: []). Única semántica confirmada: connection (DN/ER/TO de MSG_READ). Ver docs/PHASE0_VERIFICATION.md y docs/MSG_BITS_OBSERVATION.md para la semántica temporal de esos bits.',
      'Topología de san-antonio y quijote verificada por browse: son sitios mínimos reales (solo un buffer de tanque + MSG_READ). topologyVerified: true.',
      'displayName es provisional (displayNameProvisional: true) hasta confirmación escrita de la planta.',
      'generatedFrom.namespaces es referencia histórica de la captura, NO fuente de verdad para el runtime.',
    ],
    plants,
  };

  mkdirSync(dirname(DEST), { recursive: true });
  writeFileSync(DEST, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  const confirmed = plants.filter((p) => (p.connection as { confidence: string }).confidence === 'confirmed').length;
  console.log(`Generado ${DEST}`);
  console.log(`  plantas: ${plants.length} | connection confirmed: ${confirmed}/${plants.length}`);
}

main();
