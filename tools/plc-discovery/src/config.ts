import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { DiscoveryConfig } from './types';

export const TOOL_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(TOOL_ROOT, '..', '..');

// Convención del repo (apps/api/src/config/load-env.ts): .env en la raíz del monorepo.
// Un .env local del tool tiene prioridad para overrides puntuales.
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
dotenv.config({ path: path.join(TOOL_ROOT, '.env'), override: true });

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(): DiscoveryConfig {
  const raw = JSON.parse(
    fs.readFileSync(path.join(TOOL_ROOT, 'config', 'discovery.config.json'), 'utf8'),
  );
  return {
    endpointUrl: process.env.OPC_ENDPOINT ?? raw.endpointUrl,
    rootPath: process.env.OPC_ROOT_PATH
      ? process.env.OPC_ROOT_PATH.split('/').map((s) => s.trim()).filter(Boolean)
      : raw.rootPath,
    additionalRoots: raw.additionalRoots ?? [],
    username: process.env.OPC_USERNAME || undefined,
    password: process.env.OPC_PASSWORD || undefined,
    throttleMs: envNumber('DISCOVERY_THROTTLE_MS', raw.throttleMs),
    browseBatch: envNumber('DISCOVERY_BROWSE_BATCH', raw.browseBatch),
    readBatch: envNumber('DISCOVERY_READ_BATCH', raw.readBatch),
    sampleCount: envNumber('DISCOVERY_SAMPLE_COUNT', raw.sampleCount),
    sampleIntervalMs: envNumber('DISCOVERY_SAMPLE_INTERVAL_MS', raw.sampleIntervalMs),
    maxNodes: envNumber('DISC_MAX_NODES', raw.maxNodes),
    maxDepth: raw.maxDepth,
    outputDir: path.join(TOOL_ROOT, raw.outputDir),
    docsDir: path.resolve(TOOL_ROOT, raw.docsDir),
  };
}
