/**
 * Resolución de nsUri → índice de namespace. Función PURA, sin node-opcua.
 * (Runtime; los tests y el CLI la reutilizan.)
 *
 * El contrato opc_mapping.json guarda { nsUri, identifier } SIN índice. El adaptador
 * llama a resolveNamespaces() en CADA conexión y reconexión con el NamespaceArray
 * recién leído del servidor.
 *
 * POLÍTICA DE FALLO: si algún nsUri del mapping NO está en el NamespaceArray, se lanza
 * NamespaceNotFoundError → BridgeStatus = Faulted. PROHIBIDO fallback a ns=0, a un
 * índice previo, o coincidencia parcial/case-insensitive.
 */

export class NamespaceNotFoundError extends Error {
  readonly missing: string[];
  readonly available: string[];
  constructor(missing: string[], available: string[]) {
    super(
      `nsUri no encontrado en el NamespaceArray del servidor: ${missing.join(', ')}. ` +
        `Namespaces ofrecidos: ${available.join(', ')}. ` +
        `NO se aplica fallback — BridgeStatus debe pasar a Faulted.`,
    );
    this.name = 'NamespaceNotFoundError';
    this.missing = missing;
    this.available = available;
  }
}

interface MappingLike {
  plants?: Array<{
    opcBuffers?: Record<string, Array<{ node?: { nsUri?: unknown } }>>;
    connection?: Record<string, unknown>;
  }>;
}

/** Extrae los nsUri DISTINTOS usados por las referencias de nodo del mapping. */
export function collectNsUris(mapping: MappingLike): string[] {
  const uris = new Set<string>();
  const addFrom = (node: unknown): void => {
    if (node && typeof node === 'object') {
      const nsUri = (node as { nsUri?: unknown }).nsUri;
      if (typeof nsUri === 'string' && nsUri !== '') uris.add(nsUri);
    }
  };
  for (const plant of mapping.plants ?? []) {
    for (const arr of Object.values(plant.opcBuffers ?? {})) {
      if (!Array.isArray(arr)) continue;
      for (const b of arr) addFrom(b.node);
    }
    for (const key of ['done', 'error', 'timeout']) {
      addFrom((plant.connection ?? {})[key]);
    }
  }
  return [...uris].sort();
}

/**
 * Resuelve cada nsUri distinto del mapping a su índice en el NamespaceArray del
 * servidor. Coincidencia EXACTA y sensible a mayúsculas. Lanza si falta alguno.
 */
export function resolveNamespaces(namespaceArray: readonly string[], mapping: MappingLike): Map<string, number> {
  const wanted = collectNsUris(mapping);
  const resolved = new Map<string, number>();
  const missing: string[] = [];

  for (const nsUri of wanted) {
    const index = namespaceArray.indexOf(nsUri); // exacto, case-sensitive
    if (index < 0) missing.push(nsUri);
    else resolved.set(nsUri, index);
  }

  if (missing.length > 0) throw new NamespaceNotFoundError(missing, [...namespaceArray]);
  return resolved;
}
