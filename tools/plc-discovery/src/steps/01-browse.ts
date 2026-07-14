/**
 * ETAPA 01 — Descubrimiento recursivo (FASE 1).
 *
 * Resuelve cada raíz por matching de BrowseName nivel a nivel desde ObjectsFolder
 * (el índice de namespace de Optix es desconocido y puede cambiar entre reinicios,
 * por eso no se usan NodeIds ni TranslateBrowsePaths precocinados) y recorre TODO
 * el subárbol por referencias jerárquicas (Organizes/HasComponent/HasProperty), lo
 * que expande miembros de UDT y propiedades de ingeniería.
 *
 * Raíz principal: Controller Tags del PLC maestro.
 * Raíces adicionales: StationStatusVariables (salud de comunicación) y los
 * subárboles del proyecto Optix (Model/Alarms/Converters/Loggers), cuyo contenido
 * —o su ausencia— es evidencia sobre dónde vive la semántica del proceso.
 *
 * SOLO Browse/BrowseNext.
 */
import { NodeClass } from 'node-opcua';
import type { ReferenceDescription } from 'node-opcua';
import { loadConfig } from '../config';
import { connectReadOnly } from '../lib/client';
import { loadArtifact, saveArtifact } from '../lib/artifacts';
import { browseNodes, nodeClassName, normalizeName } from '../lib/browse';
import { chunk } from '../lib/batching';
import { sleep } from '../lib/throttle';
import type {
  BrowsedNode,
  DiscoveryConfig,
  EndpointsArtifact,
  NodesArtifact,
  ResolvedRoot,
  RootSpec,
} from '../types';
import { ReadOnlySession } from '../lib/readonly-session';

const OBJECTS_FOLDER = 'i=85';

async function resolveRoot(
  session: ReadOnlySession,
  spec: RootSpec,
  throttleMs: number,
): Promise<ResolvedRoot> {
  const resolved: ResolvedRoot = {
    label: spec.label,
    path: spec.path,
    nodeId: null,
    found: false,
    nodeCount: 0,
    steps: [],
  };

  let current = OBJECTS_FOLDER;
  for (const segment of spec.path) {
    const [outcome] = await browseNodes(session, [current], throttleMs);
    const siblings = outcome.references.map((r) => r.browseName.name ?? '');
    const target = outcome.references.find(
      (r) => normalizeName(r.browseName.name ?? '') === normalizeName(segment),
    );
    if (!target) {
      resolved.error =
        `No se encontró el segmento "${segment}" bajo ${current}. ` +
        `Hijos disponibles: ${siblings.join(', ') || '(ninguno)'}`;
      return resolved;
    }
    const nodeId = target.nodeId.toString();
    resolved.steps.push({
      segment,
      matchedBrowseName: target.browseName.name ?? '',
      nodeId,
      siblingBrowseNames: siblings,
    });
    current = nodeId;
    await sleep(throttleMs);
  }

  resolved.nodeId = current;
  resolved.found = true;
  return resolved;
}

function nsUriOf(nodeId: string, namespaces: string[]): string {
  const m = /^ns=(\d+);/.exec(nodeId);
  const index = m ? Number(m[1]) : 0;
  return namespaces[index] ?? `ns=${index}(desconocido)`;
}

interface BfsState {
  nodes: BrowsedNode[];
  visited: Set<string>;
  duplicates: number;
  badResults: number;
  methodsSeen: number;
  maxDepth: number;
  capped: boolean;
}

async function bfs(
  session: ReadOnlySession,
  root: ResolvedRoot,
  namespaces: string[],
  config: DiscoveryConfig,
  browseBatch: number,
  state: BfsState,
): Promise<void> {
  const rootNodeId = root.nodeId!;
  const startCount = state.nodes.length;
  state.visited.add(rootNodeId);

  const pathOf = new Map<string, string>([[rootNodeId, root.path.join('/')]]);
  let frontier: string[] = [rootNodeId];
  let depth = 0;

  while (frontier.length > 0 && depth < config.maxDepth && !state.capped) {
    depth++;
    const nextFrontier: string[] = [];

    for (const group of chunk(frontier, browseBatch)) {
      const outcomes = await browseNodes(session, group, config.throttleMs);

      outcomes.forEach((outcome, i) => {
        const parentNodeId = group[i];
        const parentPath = pathOf.get(parentNodeId) ?? '';
        if (outcome.bad) {
          state.badResults++;
          console.warn(`[01] browse Bad en ${parentNodeId}: ${outcome.statusName}`);
          return;
        }

        for (const ref of outcome.references as ReferenceDescription[]) {
          const childId = ref.nodeId.toString();
          const browseName = ref.browseName.name ?? '';
          if (ref.nodeClass === NodeClass.Method) state.methodsSeen++;

          if (state.visited.has(childId)) {
            state.duplicates++;
            continue;
          }
          state.visited.add(childId);

          if (state.nodes.length >= config.maxNodes) {
            state.capped = true;
            return;
          }

          const fullBrowsePath = `${parentPath}/${browseName}`;
          pathOf.set(childId, fullBrowsePath);

          state.nodes.push({
            nodeId: childId,
            nsUri: nsUriOf(childId, namespaces),
            rootLabel: root.label,
            browseName,
            displayName: ref.displayName?.text ?? browseName,
            nodeClass: nodeClassName(ref.nodeClass),
            typeDefinition:
              ref.typeDefinition && ref.typeDefinition.toString() !== 'ns=0;i=0'
                ? ref.typeDefinition.toString()
                : null,
            referenceType: ref.referenceTypeId.toString(),
            parentNodeId,
            fullBrowsePath,
            depth,
            hasChildren: false, // se corrige al final, cuando se conocen todos los padres
          });

          // Solo se expanden Objects y Variables. Los Methods se registran para el
          // inventario pero JAMÁS se invocan (regla dura del proyecto).
          if (ref.nodeClass === NodeClass.Object || ref.nodeClass === NodeClass.Variable) {
            nextFrontier.push(childId);
          }
        }
      });

      if (state.capped) break;
      await sleep(config.throttleMs);
    }

    if (depth > state.maxDepth) state.maxDepth = depth;
    frontier = nextFrontier;
  }

  root.nodeCount = state.nodes.length - startCount;
  console.log(
    `[01] raíz "${root.label}" (${root.path.join('/')}): ${root.nodeCount} nodos, profundidad ${depth}`,
  );
}

export async function runBrowse(): Promise<NodesArtifact> {
  const config = loadConfig();
  const preflight = loadArtifact<EndpointsArtifact>(config.outputDir, '00_endpoints.json');
  const browseBatch = preflight.effectiveBatches.browse;

  const specs: RootSpec[] = [
    { label: 'ControllerTags', path: config.rootPath },
    ...config.additionalRoots,
  ];

  const conn = await connectReadOnly(config);
  try {
    const namespaces = await conn.session.readNamespaceArray();
    const state: BfsState = {
      nodes: [],
      visited: new Set(),
      duplicates: 0,
      badResults: 0,
      methodsSeen: 0,
      maxDepth: 0,
      capped: false,
    };
    const roots: ResolvedRoot[] = [];

    for (const spec of specs) {
      const root = await resolveRoot(conn.session, spec, config.throttleMs);
      roots.push(root);
      if (!root.found) {
        // Una raíz secundaria ausente es un dato, no un fallo: se registra y se sigue.
        console.warn(`[01] raíz "${spec.label}" no resuelta: ${root.error}`);
        if (spec.label === 'ControllerTags') {
          throw new Error(
            `${root.error}\nAjusta OPC_ROOT_PATH o config/discovery.config.json.`,
          );
        }
        continue;
      }
      console.log(`[01] raíz "${root.label}" → ${root.nodeId}`);
      await bfs(conn.session, root, namespaces, config, browseBatch, state);
      if (state.capped) {
        console.warn(`[01] TOPE alcanzado (${config.maxNodes} nodos): el recorrido quedó incompleto.`);
        break;
      }
    }

    const parents = new Set(state.nodes.map((n) => n.parentNodeId));
    for (const n of state.nodes) n.hasChildren = parents.has(n.nodeId);

    const artifact: NodesArtifact = {
      capturedAt: new Date().toISOString(),
      endpointUrl: config.endpointUrl,
      roots,
      namespaces,
      nodes: state.nodes,
      stats: {
        total: state.nodes.length,
        variables: state.nodes.filter((n) => n.nodeClass === 'Variable').length,
        objects: state.nodes.filter((n) => n.nodeClass === 'Object').length,
        methodsSeenNeverCalled: state.methodsSeen,
        maxDepthReached: state.maxDepth,
        cappedAtLimit: state.capped,
        duplicateReferencesSkipped: state.duplicates,
        badBrowseResults: state.badResults,
      },
    };

    console.log(
      `[01] TOTAL=${artifact.stats.total} variables=${artifact.stats.variables} objects=${artifact.stats.objects} métodos(no invocados)=${artifact.stats.methodsSeenNeverCalled}`,
    );
    saveArtifact(config.outputDir, '01_nodes.json', artifact);
    return artifact;
  } finally {
    await conn.session.close().catch(() => undefined);
    await conn.disconnect();
  }
}

if (require.main === module) {
  runBrowse().catch((err) => {
    console.error(`\n[01] FALLÓ: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
