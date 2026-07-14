/**
 * Poda los artefactos crudos de output/ a los FIXTURES versionados que consume el
 * generador del contrato (apps/api/fixtures/plc-discovery/). Parte del pipeline de
 * recaptura del PLC — NO del runtime.
 *
 * Por qué: output/ está gitignored (contiene ~14 MB de lecturas y timestamps por
 * nodo). El generador del contrato no puede depender de archivos que nadie más tiene.
 * Estos fixtures son evidencia congelada de topología: pequeños, trackeados y con
 * diff legible cuando se recapture el PLC.
 *
 * Recaptura: correr las etapas del tool (00→02) + verify-phase0, luego este script.
 * Ejecutar: npx tsx src/build-fixtures.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT_DIR = join(__dirname, '..', 'output');
const FIX_DIR = join(__dirname, '..', '..', '..', 'apps', 'api', 'fixtures', 'plc-discovery');

function write(name: string, data: unknown): void {
  mkdirSync(dirname(join(FIX_DIR, name)), { recursive: true });
  writeFileSync(join(FIX_DIR, name), JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  fixture: ${name}`);
}
function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(OUT_DIR, name), 'utf8')) as T;
}

// ── nodes.json: solo los campos que el generador consume ─────────────────────
interface RawNode {
  nodeId: string; nsUri: string; browseName: string;
  parentNodeId: string; depth: number; rootLabel: string;
}
const nodesRaw = read<{ capturedAt: string; namespaces: string[]; nodes: RawNode[] }>('01_nodes.json');
write('nodes.json', {
  capturedAt: nodesRaw.capturedAt,
  namespaces: nodesRaw.namespaces,
  nodes: nodesRaw.nodes.map((n) => ({
    nodeId: n.nodeId,
    nsUri: n.nsUri,
    browseName: n.browseName,
    parentNodeId: n.parentNodeId,
    depth: n.depth,
    rootLabel: n.rootLabel,
  })),
});

// ── readings.json: dataType + arrayLength por nodo (se descartan valores/muestras) ──
interface RawReading {
  nodeId: string;
  attrs: { dataType: { name: string }; arrayDimensions: number[] | null };
}
const readingsRaw = read<{ endpointUrl: string; readings: RawReading[] }>('02_readings.json');
write('readings.json', {
  endpointUrl: readingsRaw.endpointUrl,
  readings: readingsRaw.readings.map((r) => ({
    nodeId: r.nodeId,
    dataType: r.attrs.dataType.name,
    arrayLength: Array.isArray(r.attrs.arrayDimensions) && r.attrs.arrayDimensions.length
      ? r.attrs.arrayDimensions[0]
      : null,
  })),
});

// ── connection-verification.json: confidence por sitio + evidencia de DN/ER/TO ──
interface RawConn {
  site: string;
  msgRead: string | null;
  members: Record<string, { status: string } | null>;
  confidence: 'confirmed' | 'inferred';
}
const verifyRaw = read<{ verifiedAt: string; hallazgo5_connection: RawConn[]; hallazgo3_topologia: unknown }>('phase0_verification.json');
write('connection-verification.json', {
  verifiedAt: verifyRaw.verifiedAt,
  connections: verifyRaw.hallazgo5_connection.map((c) => ({
    site: c.site,
    msgRead: c.msgRead,
    confidence: c.confidence,
    memberStatus: {
      DN: c.members.DN?.status ?? null,
      ER: c.members.ER?.status ?? null,
      TO: c.members.TO?.status ?? null,
    },
  })),
  topology: verifyRaw.hallazgo3_topologia,
});

console.log('Fixtures escritos en apps/api/fixtures/plc-discovery/');
