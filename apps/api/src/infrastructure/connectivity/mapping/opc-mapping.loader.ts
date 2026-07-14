import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Carga config/opc_mapping.json y expone lo que el adaptador necesita para
 * suscribirse: la lista de buffers de datos por planta con su { nsUri, identifier }.
 * Fail-fast: si el archivo falta o no parsea, el proceso no arranca.
 *
 * NO valida el schema completo aquí (eso es scripts/validate-mapping.ts, gate de CI);
 * hace comprobaciones mínimas de forma para fallar temprano y claro.
 */

export interface NodeRef {
  nsUri: string;
  identifier: string; // con prefijo de tipo: g= | i= | s= | b=
}

export interface MonitorTarget {
  plantId: string;
  browseName: string;
  channel: string;
  node: NodeRef;
  arrayLength: number | null;
  dataType: string | null;
}

/** Señal de proceso mapeada: un elemento de un buffer con semántica de dominio. */
export interface SignalMapping {
  plantId: string;
  buffer: string; // canal (realIn, intIn, …); refiere al buffer PRIMARIO de ese canal en el sitio
  index: number;
  domainKey: string;
  label: string | null;
  unit: string | null;
  min: number | null;
  max: number | null;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: 'confirmed' | 'inferred' | 'estimated';
  writable: boolean;
}

export interface LoadedPlant {
  plantId: string;
  displayName: string;
  /** Ventana de liveness específica del sitio (s). null → usar el default de .env. */
  livenessWindowSec: number | null;
}

export interface LoadedMapping {
  version: string;
  protocolVersion: string;
  dtoVersion: string;
  plants: LoadedPlant[];
  targets: MonitorTarget[];
  signals: SignalMapping[];
  raw: unknown; // el documento completo, para resolveNamespaces()
}

// Canales de DATOS que se suscriben (1 MonitoredItem por buffer, regla 6).
// Se excluyen msgRead/msgWrite: son estructuras de diagnóstico, no arrays de proceso.
const DATA_CHANNELS = new Set(['realIn', 'realOut', 'intIn', 'intOut', 'bitIn', 'bitOut']);

function resolvePath(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.OPC_MAPPING_PATH,
    join(process.cwd(), 'config', 'opc_mapping.json'),
    join(process.cwd(), 'apps', 'api', 'config', 'opc_mapping.json'),
    join(__dirname, '..', '..', '..', '..', 'config', 'opc_mapping.json'),
  ].filter((c): c is string => !!c);

  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(`No se encontró opc_mapping.json. Rutas probadas: ${candidates.join(', ')}`);
  }
  return found;
}

interface RawSignal {
  buffer?: string;
  index?: number;
  domainKey?: string;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  mappingStatus?: string;
  confidence?: string;
  writable?: boolean;
}

export function loadMapping(explicitPath?: string): LoadedMapping {
  const path = resolvePath(explicitPath);
  const doc = JSON.parse(readFileSync(path, 'utf8')) as {
    version?: string;
    protocolVersion?: string;
    dtoVersion?: string;
    plants?: Array<{
      plantId?: string;
      displayName?: string;
      livenessWindowSec?: number;
      opcBuffers?: Record<
        string,
        Array<{ browseName?: string; node?: { nsUri?: string; identifier?: string }; arrayLength?: number | null; dataType?: string | null }>
      >;
      signals?: RawSignal[];
    }>;
  };

  if (!Array.isArray(doc.plants) || doc.plants.length === 0) {
    throw new Error(`opc_mapping.json inválido (${path}): sin plants[]`);
  }

  const targets: MonitorTarget[] = [];
  const signals: SignalMapping[] = [];
  const plants: LoadedPlant[] = [];

  for (const plant of doc.plants) {
    if (!plant.plantId) throw new Error(`opc_mapping.json: planta sin plantId en ${path}`);
    plants.push({
      plantId: plant.plantId,
      displayName: plant.displayName ?? plant.plantId,
      livenessWindowSec: typeof plant.livenessWindowSec === 'number' ? plant.livenessWindowSec : null,
    });

    for (const [channel, buffers] of Object.entries(plant.opcBuffers ?? {})) {
      if (!DATA_CHANNELS.has(channel)) continue;
      for (const b of buffers ?? []) {
        if (!b.browseName || !b.node?.nsUri || !b.node?.identifier) {
          throw new Error(`opc_mapping.json: buffer inválido en ${plant.plantId}/${channel}`);
        }
        targets.push({
          plantId: plant.plantId,
          browseName: b.browseName,
          channel,
          node: { nsUri: b.node.nsUri, identifier: b.node.identifier },
          arrayLength: typeof b.arrayLength === 'number' ? b.arrayLength : null,
          dataType: typeof b.dataType === 'string' ? b.dataType : null,
        });
      }
    }

    for (const s of plant.signals ?? []) {
      if (!s.buffer || typeof s.index !== 'number' || !s.domainKey) {
        throw new Error(`opc_mapping.json: signal inválida en ${plant.plantId} (buffer/index/domainKey)`);
      }
      signals.push({
        plantId: plant.plantId,
        buffer: s.buffer,
        index: s.index,
        domainKey: s.domainKey,
        label: s.label ?? null,
        unit: s.unit ?? null,
        min: typeof s.min === 'number' ? s.min : null,
        max: typeof s.max === 'number' ? s.max : null,
        mappingStatus: s.mappingStatus === 'unmapped' ? 'unmapped' : 'mapped',
        confidence: (s.confidence as SignalMapping['confidence']) ?? 'inferred',
        writable: s.writable === true,
      });
    }
  }

  return {
    version: doc.version ?? '0.0.0',
    protocolVersion: doc.protocolVersion ?? 'v0',
    dtoVersion: doc.dtoVersion ?? 'v1',
    plants,
    targets,
    signals,
    raw: doc,
  };
}
