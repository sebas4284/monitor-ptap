/**
 * Validador de config/opc_mapping.json.
 *
 * Dos capas:
 *  1) Estructural — JSON Schema draft 2020-12 vía ajv.
 *  2) Semántica  — reglas que JSON Schema no puede expresar (comparar campos
 *     hermanos y unicidad por propiedad): índice duplicado por buffer, domainKey
 *     duplicado por planta, min>=max, y coherencia de connection cuando está mapped.
 *
 * Se ejecuta como CLI (`npm run validate:mapping`) y se reutiliza desde los tests.
 * No forma parte del runtime del backend (vive fuera de src/).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

interface NodeRefLike { nsUri?: unknown; identifier?: unknown }
function isNodeRef(v: unknown): v is { nsUri: string; identifier: string } {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as NodeRefLike).nsUri === 'string' && (v as NodeRefLike).nsUri !== '' &&
    typeof (v as NodeRefLike).identifier === 'string' && (v as NodeRefLike).identifier !== ''
  );
}

/** Reglas semánticas que el JSON Schema no cubre. Tolera entradas malformadas. */
export function semanticErrors(mapping: unknown): string[] {
  const errors: string[] = [];
  if (typeof mapping !== 'object' || mapping === null) return errors;
  const plants = (mapping as { plants?: unknown }).plants;
  if (!Array.isArray(plants)) return errors;

  plants.forEach((plant, pIdx) => {
    if (typeof plant !== 'object' || plant === null) return;
    const p = plant as {
      plantId?: unknown;
      signals?: unknown;
      connection?: { mappingStatus?: unknown; done?: unknown; error?: unknown; timeout?: unknown };
    };
    const label = typeof p.plantId === 'string' ? p.plantId : `plants[${pIdx}]`;

    const signals = Array.isArray(p.signals) ? p.signals : [];
    const seenSlot = new Set<string>();
    const seenDomainKey = new Set<string>();

    signals.forEach((signal, sIdx) => {
      if (typeof signal !== 'object' || signal === null) return;
      const s = signal as {
        buffer?: unknown;
        index?: unknown;
        domainKey?: unknown;
        min?: unknown;
        max?: unknown;
      };

      if (typeof s.buffer === 'string' && typeof s.index === 'number') {
        const slot = `${s.buffer}[${s.index}]`;
        if (seenSlot.has(slot)) {
          errors.push(`${label}: índice duplicado ${slot} (señal #${sIdx})`);
        }
        seenSlot.add(slot);
      }

      if (typeof s.domainKey === 'string') {
        if (seenDomainKey.has(s.domainKey)) {
          errors.push(`${label}: domainKey duplicado "${s.domainKey}" (señal #${sIdx})`);
        }
        seenDomainKey.add(s.domainKey);
      }

      if (typeof s.min === 'number' && typeof s.max === 'number' && s.min >= s.max) {
        errors.push(`${label}: min >= max (${s.min} >= ${s.max}) en "${String(s.domainKey)}"`);
      }
    });

    const conn = p.connection;
    if (conn && conn.mappingStatus === 'mapped') {
      for (const key of ['done', 'error', 'timeout'] as const) {
        if (!isNodeRef(conn[key])) {
          errors.push(`${label}: connection.mappingStatus="mapped" pero ${key} no es una referencia de nodo válida`);
        }
      }
    }

    // Guard anti-namespace embebido: ningún identifier puede contener "ns=".
    for (const ref of collectNodeRefs(plant)) {
      if (typeof ref.identifier === 'string' && /(^|;)\s*ns=/i.test(ref.identifier)) {
        errors.push(`${label}: identifier con índice de namespace embebido ("${ref.identifier}") — usar nsUri`);
      }
    }
  });

  return errors;
}

/** Recolecta todas las referencias de nodo dentro de una planta (buffers + connection). */
function collectNodeRefs(plant: unknown): NodeRefLike[] {
  const refs: NodeRefLike[] = [];
  if (typeof plant !== 'object' || plant === null) return refs;
  const p = plant as { opcBuffers?: Record<string, unknown>; connection?: Record<string, unknown> };
  if (p.opcBuffers && typeof p.opcBuffers === 'object') {
    for (const arr of Object.values(p.opcBuffers)) {
      if (!Array.isArray(arr)) continue;
      for (const b of arr) {
        const node = (b as { node?: unknown }).node;
        if (node && typeof node === 'object') refs.push(node as NodeRefLike);
      }
    }
  }
  if (p.connection && typeof p.connection === 'object') {
    for (const key of ['done', 'error', 'timeout']) {
      const node = (p.connection as Record<string, unknown>)[key];
      if (node && typeof node === 'object') refs.push(node as NodeRefLike);
    }
  }
  return refs;
}

export function validateMapping(schema: object, mapping: unknown): ValidationResult {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const errors: string[] = [];

  if (!validate(mapping)) {
    for (const e of validate.errors ?? []) {
      errors.push(`schema ${e.instancePath || '/'} ${e.message ?? 'inválido'}`.trim());
    }
  }

  errors.push(...semanticErrors(mapping));
  return { ok: errors.length === 0, errors };
}

function runCli(): void {
  const configDir = join(__dirname, '..', 'config');
  const schema = loadJson(join(configDir, 'opc_mapping.schema.json')) as object;
  const mapping = loadJson(join(configDir, 'opc_mapping.json'));

  const result = validateMapping(schema, mapping);
  if (result.ok) {
    const plantCount = Array.isArray((mapping as { plants?: unknown[] }).plants)
      ? (mapping as { plants: unknown[] }).plants.length
      : 0;
    console.log(`✓ opc_mapping.json válido (${plantCount} plantas)`);
    process.exit(0);
  }

  console.error('✗ opc_mapping.json INVÁLIDO:');
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (require.main === module) {
  runCli();
}
