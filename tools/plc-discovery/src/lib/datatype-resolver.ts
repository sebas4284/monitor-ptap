import { AttributeIds } from 'node-opcua';
import { ReadOnlySession } from './readonly-session';
import { readInBatches } from './batching';
import { localizedTextToString } from './values';

/** Tipos builtin/derivados frecuentes de ns=0 (fallback si el servidor no responde). */
const BUILTIN_NS0: Record<number, string> = {
  1: 'Boolean',
  2: 'SByte',
  3: 'Byte',
  4: 'Int16',
  5: 'UInt16',
  6: 'Int32',
  7: 'UInt32',
  8: 'Int64',
  9: 'UInt64',
  10: 'Float',
  11: 'Double',
  12: 'String',
  13: 'DateTime',
  14: 'Guid',
  15: 'ByteString',
  16: 'XmlElement',
  17: 'NodeId',
  19: 'StatusCode',
  20: 'QualifiedName',
  21: 'LocalizedText',
  22: 'Structure',
  24: 'BaseDataType',
  26: 'Number',
  27: 'Integer',
  28: 'UInteger',
  29: 'Enumeration',
  290: 'Duration',
  294: 'UtcTime',
  884: 'Range',
  887: 'EUInformation',
};

/**
 * Resuelve NodeIds de DataType/TypeDefinition a nombres legibles leyendo el
 * DisplayName de cada nodo de tipo (batcheado); cae al mapa builtin si falla.
 */
export async function resolveTypeNames(
  session: ReadOnlySession,
  typeNodeIds: string[],
  batchSize: number,
  throttleMs: number,
): Promise<Record<string, string>> {
  const distinct = [...new Set(typeNodeIds)].filter((id) => id && id !== 'null');
  const resolved: Record<string, string> = {};
  if (distinct.length === 0) return resolved;

  try {
    const dataValues = await readInBatches(
      session,
      distinct.map((nodeId) => ({ nodeId, attributeId: AttributeIds.DisplayName })),
      batchSize,
      throttleMs,
      'tipos',
    );
    dataValues.forEach((dv, i) => {
      const name = dv.value ? localizedTextToString(dv.value.value) : null;
      if (name) resolved[distinct[i]] = name;
    });
  } catch (err) {
    console.warn(
      `[tipos] no se pudieron resolver DisplayNames (${err instanceof Error ? err.message : err}); uso mapa builtin`,
    );
  }

  for (const id of distinct) {
    if (resolved[id]) continue;
    const match = /^(?:ns=0;)?i=(\d+)$/.exec(id);
    const numeric = match ? Number(match[1]) : NaN;
    resolved[id] = BUILTIN_NS0[numeric] ?? id;
  }
  return resolved;
}
