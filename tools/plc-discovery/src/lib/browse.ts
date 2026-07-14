import {
  BrowseDirection,
  NodeClass,
  resolveNodeId,
} from 'node-opcua';
import type { BrowseDescriptionLike, NodeIdLike, ReferenceDescription } from 'node-opcua';
import { ReadOnlySession } from './readonly-session';
import { sleep } from './throttle';
import { statusCodeToJson } from './values';

export interface BrowseOutcome {
  references: ReferenceDescription[];
  bad: boolean;
  statusName: string;
}

const HIERARCHICAL = resolveNodeId('HierarchicalReferences');

function toBrowseDescription(nodeId: NodeIdLike): BrowseDescriptionLike {
  return {
    nodeId,
    referenceTypeId: HIERARCHICAL,
    includeSubtypes: true,
    browseDirection: BrowseDirection.Forward,
    nodeClassMask: 0, // todas las clases
    resultMask: 63, // ReferenceType | IsForward | NodeClass | BrowseName | DisplayName | TypeDefinition
  };
}

/**
 * Browse batcheado con manejo completo de continuation points.
 * Los continuation points se agotan (releaseContinuationPoints=false hasta el
 * último lote) y quedan liberados al terminar cada nodo.
 */
export async function browseNodes(
  session: ReadOnlySession,
  nodeIds: NodeIdLike[],
  throttleMs: number,
): Promise<BrowseOutcome[]> {
  const results = await session.browse(nodeIds.map(toBrowseDescription));
  const outcomes: BrowseOutcome[] = results.map((r) => ({
    references: [...(r.references ?? [])],
    bad: statusCodeToJson(r.statusCode).severity === 'Bad',
    statusName: statusCodeToJson(r.statusCode).name,
  }));

  let pending = results
    .map((r, index) => ({ index, cp: r.continuationPoint }))
    .filter((p): p is { index: number; cp: Buffer } => !!p.cp && p.cp.length > 0);

  while (pending.length > 0) {
    await sleep(throttleMs);
    const nextResults = await session.browseNext(pending.map((p) => p.cp), false);
    const stillPending: Array<{ index: number; cp: Buffer }> = [];
    nextResults.forEach((r, j) => {
      const target = pending[j].index;
      outcomes[target].references.push(...(r.references ?? []));
      if (r.continuationPoint && r.continuationPoint.length > 0) {
        stillPending.push({ index: target, cp: r.continuationPoint });
      }
    });
    pending = stillPending;
  }

  return outcomes;
}

export function nodeClassName(nc: NodeClass): string {
  return NodeClass[nc] ?? String(nc);
}

/** Normaliza BrowseNames para matching tolerante ("Controller Tags" ≡ "ControllerTags"). */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '');
}
