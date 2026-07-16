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

/** Elemento de un buffer (canal + browseName + índice). Fase 5: destino/feedback de escritura. */
export interface BufferElementRef {
  channel: string;
  sourceBuffer: string;
  index: number;
}

/** Fase 5: traducción de comando de dominio a escritura de buffer/bit (vive en el mapping, regla 2). */
export interface WriteSpec {
  target: BufferElementRef; // buffer de SALIDA donde se escribe
  commands: Record<string, number | boolean>; // verbo → valor a escribir
  readBack: {
    channel: string;
    sourceBuffer: string | null;
    index: number;
    confirmsWrittenValue: boolean;
    expectedValue?: number | boolean;
  };
  timeoutMs: number;
  rollbackValue: number | boolean;
  permission: string; // Permission de @ptap/shared (control_valves | acknowledge_alarms | adjust_setpoints)
}

/** Señal de proceso mapeada: un elemento de un buffer con semántica de dominio. */
export interface SignalMapping {
  plantId: string;
  buffer: string; // canal (realIn, intIn, …); refiere al buffer PRIMARIO de ese canal en el sitio
  /** browseName exacto del buffer fuente. Obligatorio si el canal tiene varios buffers del mismo tamaño (la resolución por tamaño sería no determinista). */
  sourceBuffer?: string | null;
  index: number;
  domainKey: string;
  label: string | null;
  unit: string | null;
  min: number | null;
  max: number | null;
  /** Rango operativo/normativo (se expone en el DTO para que el front lo muestre). */
  opMin?: number | null;
  opMax?: number | null;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: 'confirmed' | 'inferred' | 'estimated';
  writable: boolean;
  /** Presente solo si writable (⇒ confidence:confirmed, garantizado por el schema). */
  write?: WriteSpec;
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

interface RawWriteSpec {
  target?: { channel?: string; sourceBuffer?: string; index?: number };
  commands?: Record<string, number | boolean>;
  readBack?: { channel?: string; sourceBuffer?: string; index?: number; confirmsWrittenValue?: boolean; expectedValue?: number | boolean };
  timeoutMs?: number;
  rollbackValue?: number | boolean;
  permission?: string;
}

interface RawSignal {
  buffer?: string;
  sourceBuffer?: string;
  index?: number;
  domainKey?: string;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  opMin?: number;
  opMax?: number;
  mappingStatus?: string;
  confidence?: string;
  writable?: boolean;
  write?: RawWriteSpec;
}

/**
 * Parsea el write spec. Confía en que el schema ya validó la forma (validate:mapping es el
 * gate); aquí solo se normaliza. Devuelve undefined si la señal no es writable o no lo trae.
 */
function parseWriteSpec(raw: RawWriteSpec | undefined): WriteSpec | undefined {
  if (!raw || !raw.target || !raw.commands || !raw.readBack) return undefined;
  const { channel, sourceBuffer, index } = raw.target;
  if (typeof channel !== 'string' || typeof sourceBuffer !== 'string' || typeof index !== 'number') return undefined;
  if (typeof raw.readBack.channel !== 'string' || typeof raw.readBack.index !== 'number') return undefined;
  if (typeof raw.timeoutMs !== 'number' || typeof raw.permission !== 'string') return undefined;
  if (raw.rollbackValue === undefined) return undefined;
  return {
    target: { channel, sourceBuffer, index },
    commands: raw.commands,
    readBack: {
      channel: raw.readBack.channel,
      sourceBuffer: typeof raw.readBack.sourceBuffer === 'string' ? raw.readBack.sourceBuffer : null,
      index: raw.readBack.index,
      confirmsWrittenValue: raw.readBack.confirmsWrittenValue !== false,
      expectedValue: raw.readBack.expectedValue,
    },
    timeoutMs: raw.timeoutMs,
    rollbackValue: raw.rollbackValue,
    permission: raw.permission,
  };
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
        sourceBuffer: typeof s.sourceBuffer === 'string' ? s.sourceBuffer : null,
        index: s.index,
        domainKey: s.domainKey,
        label: s.label ?? null,
        unit: s.unit ?? null,
        min: typeof s.min === 'number' ? s.min : null,
        max: typeof s.max === 'number' ? s.max : null,
        opMin: typeof s.opMin === 'number' ? s.opMin : null,
        opMax: typeof s.opMax === 'number' ? s.opMax : null,
        mappingStatus: s.mappingStatus === 'unmapped' ? 'unmapped' : 'mapped',
        confidence: (s.confidence as SignalMapping['confidence']) ?? 'inferred',
        writable: s.writable === true,
        write: s.writable === true ? parseWriteSpec(s.write) : undefined,
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
