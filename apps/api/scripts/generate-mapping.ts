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

interface SignalDef {
  buffer: string;
  index: number;
  domainKey: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Rango operativo/normativo (alarmas futuras). Fuera de él la lectura SIGUE siendo usable. */
  opMin?: number;
  opMax?: number;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: 'confirmed' | 'inferred' | 'estimated';
  writable: boolean;
}

/**
 * Señales de proceso mapeadas. SIN export L5X, la semántica proviene del HMI de Optix
 * (NodeId exacto por sitio) verificada contra el PLC. `buffer:'realIn'` refiere al buffer
 * realIn PRIMARIO del sitio (el de arrayLength mayor), no a los de tanque TK1/TK2/TK3.
 *
 * - MONTEBELLO: caudales de entrada, verificados en vivo (idx0 ≈ HMI 14.22; idx1 =
 *   totalizador; idx5 ≈ 23.2). Evidencia: docs/FLOW_VALIDATION.md.
 * - CAMPOALEGRE: confirmación del operador desde el HMI (2026-07-14): idx0 = caudal de
 *   salida 1, idx7 = caudal de salida 2 (l/s), idx12 = presión de salida 1 e idx13 =
 *   presión de salida 2 en psi con rango de instrumento 0–16 bar → max 232 psi.
 *   Tanques (misma sesión, mismo buffer): idx5/idx6 = nivel (m) / volumen (m³) del
 *   tanque 1, idx14/idx15 = tanque 2, idx16/idx17 = tanque 3. Identificador verificado
 *   contra el mapping (REAL_IN_CAMPOALEGRE = g=E1680D60-7BCD-C892-7257-C4D4AAE41E1C).
 * - ALTO_MANGOS: confirmación del operador (2026-07-14, "planta Real Mangos" = buffer
 *   DATOS_REAL_IN_MANGOS, g=ECA4ABBE-2E70-B864-5B3D-B2E9D1FB7830, único realIn del sitio
 *   fusionado MANGOS/ALTO_MANGOS). idx0 caudal de entrada e idx7 caudal de salida (l/s);
 *   idx5/idx6 nivel (m, lleno a 2.5 m) / volumen (m³) del tanque único; idx12 presión de
 *   entrada e idx13 presión de salida (psi, rango operativo 1–3).
 *
 * - CARBONERO: confirmación del operador (2026-07-14), buffer REAL_IN_CARBONERO
 *   (g=A1323D1F-4114-A49D-746E-D6DDBB3C7DE3). Entrada: idx0 caudal (l/s), idx2 turbiedad
 *   (NTU), idx3 oxígeno disuelto (mg/L), idx4 conductividad (µS/cm), idx5 pH,
 *   idx6 temperatura (°C). Tanque único: idx7 nivel (m), idx8 volumen (m³). Salida:
 *   idx11 turbiedad (NTU), idx13 pH, idx14 temperatura (°C), idx20 presión (psi).
 *   Los rangos entregados por el operador (pH 5.5–9, turbiedad salida ≤1 NTU, etc.) son
 *   OPERATIVOS/normativos → van en opMin/opMax; min/max quedan como límites físicos
 *   amplios para que una lectura anómala real (pH 5.8, tanque en 0.5 m) NO se descarte
 *   como OUT_OF_RANGE justo cuando más importa verla.
 *
 *   OJO: los índices NO son transferibles entre plantas (realIn[5] aquí es nivel de
 *   tanque; en MONTEBELLO es caudal). Toda señal se direcciona por (plantId, domainKey).
 *
 * confidence: 'inferred' (NO confirmed): inferencias muy fundadas, pero el documento
 * oficial de la planta aún no vive en el repo. El schema PROHÍBE writable:true sin
 * confidence:'confirmed' — esa red de seguridad queda intacta (writable:false).
 * Los máximos son bounds plausibles (caudal 1000 l/s; presión 232 psi = 16 bar), no la
 * capacidad de diseño real. Upgrade a 'confirmed': añadir el documento a
 * docs/plant-documentation/ y cambiar confidence + max aquí.
 */
const SIGNALS_BY_SITE: Record<string, SignalDef[]> = {
  MONTEBELLO: [
    { buffer: 'realIn', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada 1', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'inletFlow2', label: 'Caudal de entrada 2', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
  ],
  CAMPOALEGRE: [
    { buffer: 'realIn', index: 0, domainKey: 'outletFlow1', label: 'Caudal de salida 1', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 20, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'outletFlow2', label: 'Caudal de salida 2', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 12, domainKey: 'outletPressure1', label: 'Presión de salida 1', unit: 'psi', min: 0, max: 232, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPressure2', label: 'Presión de salida 2', unit: 'psi', min: 0, max: 232, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 14, domainKey: 'tank2Level', label: 'Nivel tanque 2', unit: 'm', min: 0, max: 20, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 15, domainKey: 'tank2Volume', label: 'Volumen tanque 2', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 16, domainKey: 'tank3Level', label: 'Nivel tanque 3', unit: 'm', min: 0, max: 20, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 17, domainKey: 'tank3Volume', label: 'Volumen tanque 3', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
  ],
  ALTO_MANGOS: [
    { buffer: 'realIn', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMax: 2.5, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'outletFlow1', label: 'Caudal de salida', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 12, domainKey: 'inletPressure1', label: 'Presión de entrada', unit: 'psi', min: 0, max: 232, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: 0, max: 232, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
  ],
  CARBONERO: [
    { buffer: 'realIn', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 2, domainKey: 'inletTurbidity', label: 'Turbiedad de entrada', unit: 'NTU', min: 0, max: 1000, opMin: 0, opMax: 5, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 3, domainKey: 'inletOxygen', label: 'Oxígeno de entrada', unit: 'mg/L', min: 0, max: 20, opMin: 4, opMax: 15, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 4, domainKey: 'conductivity', label: 'Conductividad', unit: 'µS/cm', min: 0, max: 10000, opMin: 0.1, opMax: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'inletPh', label: 'pH de entrada', unit: 'pH', min: 0, max: 14, opMin: 5.5, opMax: 9, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'inletTemperature', label: 'Temperatura de entrada', unit: '°C', min: 0, max: 50, opMin: 10, opMax: 30, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2.8, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 8, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 11, domainKey: 'outletTurbidity', label: 'Turbiedad de salida', unit: 'NTU', min: 0, max: 1000, opMin: 0, opMax: 1, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPh', label: 'pH de salida', unit: 'pH', min: 0, max: 14, opMin: 6, opMax: 8, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 14, domainKey: 'outletTemperature', label: 'Temperatura de salida', unit: '°C', min: 0, max: 50, opMin: 10, opMax: 30, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 20, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: 0, max: 232, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
  ],
};

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
    plant.signals = SIGNALS_BY_SITE[site] ?? [];
    return plant;
  });

  const doc = {
    $schema: './opc_mapping.schema.json',
    version: '0.7.0',
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
      'Sin export L5X: casi TODA señal de proceso sigue unmapped (signals: []). Única semántica confirmada por lectura: connection (DN/ER/TO de MSG_READ). Ver docs/PHASE0_VERIFICATION.md y docs/MSG_BITS_OBSERVATION.md.',
      'Excepción: montebello.signals mapea inletFlow1 (realIn[0]) e inletFlow2 (realIn[5]) como caudales de entrada en l/s. confidence: INFERRED — inferidos del HMI de Optix (NodeId g=eba8e3eb-53a2-0ccd-3912-501c0f7e4c8f = REAL_IN_MONTEBELLO) y verificados en vivo, NO del L5X ni de documento oficial de la planta. Evidencia: docs/FLOW_VALIDATION.md. buffer:realIn = el buffer realIn primario del sitio (arrayLength 50), no los de tanque. El máximo (1000 l/s) es un bound físico plausible, no la capacidad de diseño.',
      'Excepción: campoalegre.signals mapea outletFlow1 (realIn[0]), outletFlow2 (realIn[7]) en l/s; outletPressure1 (realIn[12]) y outletPressure2 (realIn[13]) en psi; y tanques 1/2/3: nivel en m y volumen en m³ en realIn[5]/[6], realIn[14]/[15] y realIn[16]/[17]. confidence: INFERRED — confirmación del operador desde el HMI de Optix (2026-07-14; identificador verificado: REAL_IN_CAMPOALEGRE = g=E1680D60-7BCD-C892-7257-C4D4AAE41E1C), NO del L5X ni de documento oficial. Rango de presión: instrumento 0–16 bar → max 232 psi. Máximos de nivel (20 m) y volumen (10000 m³) son bounds plausibles, no dimensiones reales del tanque.',
      'Los índices de array NO son transferibles entre plantas (realIn[5] es nivel de tanque en campoalegre y caudal en montebello). El código debe direccionar señales SIEMPRE por (plantId, domainKey), nunca por índice global.',
      'Excepción: alto-los-mangos.signals mapea 6 señales de DATOS_REAL_IN_MANGOS (g=ECA4ABBE-2E70-B864-5B3D-B2E9D1FB7830, único buffer realIn del sitio fusionado): caudal de entrada[0] y salida[7] l/s; tanque 1 nivel[5] m (lleno a 2.5 m, confirmado por operador) y volumen[6] m³; presión de entrada[12] y salida[13] psi (op 1–3). confidence: INFERRED — confirmación del operador (2026-07-14), NO del L5X ni de documento oficial en el repo.',
      'Excepción: carbonero.signals mapea 12 señales de REAL_IN_CARBONERO (g=A1323D1F-4114-A49D-746E-D6DDBB3C7DE3): entrada = caudal[0] l/s, turbiedad[2] NTU, oxígeno[3] mg/L, conductividad[4] µS/cm, pH[5], temperatura[6] °C; tanque 1 = nivel[7] m, volumen[8] m³; salida = turbiedad[11] NTU, pH[13], temperatura[14] °C, presión[20] psi. confidence: INFERRED — confirmación del operador (2026-07-14), NO del L5X ni de documento oficial en el repo.',
      'opMin/opMax = rango OPERATIVO/normativo entregado por el operador (insumo de alarmas futuras). NO confundir con min/max, que son límites de validez física: una lectura fuera de [opMin,opMax] pero dentro de [min,max] es un dato REAL y usable (p. ej. pH de salida 5.8 o tanque en 0.5 m) que la UI debe mostrar, no descartar.',
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
