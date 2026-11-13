import { createHash, createHmac } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import type { CommandFacts, EslabonRoto } from './command-signature';
import { selloCoincide } from './command-signature';

export type LegacyRow = CommandFacts & { signature: string | null; prevSignature: string | null };
export interface ReviewedLegacyBoundary {
  version: 1;
  acceptedAt: string;
  factsSha256: string;
  unsignedIds: number[];
  initialSignedCount: number;
  initialTip: string | null;
  rows: LegacyRow[];
}
export interface LegacyBoundaryExpectation {
  total: number; unsigned: number; count: number; tip: string | null; factsSha256: string;
}

// Exact same projection as the read-only review helper; signatures remain original.
function projection(f: LegacyRow): (string | number | null)[] {
  return [f.id, f.at, f.plantId, f.target, f.command, f.status, f.userId, f.userName,
    f.userEmail, f.role, f.writtenValue, f.confirmedValue, f.signature, f.prevSignature];
}
export function legacyFactsDigest(rows: LegacyRow[]): string {
  return createHash('sha256').update(JSON.stringify([...rows].sort((a, b) => a.id - b.id).map(projection))).digest('hex');
}

/** A reviewed snapshot proves preservation since acceptance, never historic authenticity. */
export class CommandLegacyBoundaryStore {
  readonly path: string;
  constructor(private readonly secret: string, checkpointPath: string) { this.path = `${checkpointPath}.legacy-boundary.json`; }

  async exists(): Promise<boolean> {
    try { await readFile(this.path); return true; }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false; throw err; }
  }
  private mac(boundary: ReviewedLegacyBoundary): string {
    return createHmac('sha256', this.secret).update('ptap-command-legacy-boundary-v1\n').update(JSON.stringify(boundary)).digest('hex');
  }
  /** Caller holds checkpoint lock. Never overwrite a prior manifest, even after a crash. */
  async create(boundary: ReviewedLegacyBoundary): Promise<string> {
    const bytes = JSON.stringify({ boundary, mac: this.mac(boundary) });
    if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) throw new Error('manifest legacy excede límite');
    const file = await open(this.path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    return createHash('sha256').update(bytes).digest('hex');
  }
  async read(expectedSha256: string): Promise<ReviewedLegacyBoundary> {
    const bytes = await readFile(this.path);
    if (bytes.length > 16 * 1024 * 1024 || !selloCoincide(createHash('sha256').update(bytes).digest('hex'), expectedSha256)) throw new Error('manifest legacy distinto');
    const envelope = JSON.parse(bytes.toString('utf8')) as { boundary: ReviewedLegacyBoundary; mac: string };
    const b = envelope.boundary;
    if (!b || typeof envelope.mac !== 'string' || !selloCoincide(this.mac(b), envelope.mac) || b.version !== 1 ||
      !Array.isArray(b.rows) || !b.rows.length || !Array.isArray(b.unsignedIds) ||
      typeof b.acceptedAt !== 'string' || !Number.isFinite(Date.parse(b.acceptedAt)) ||
      typeof b.factsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(b.factsSha256) ||
      !Number.isSafeInteger(b.initialSignedCount) || b.initialSignedCount < 0 ||
      (b.initialSignedCount === 0 ? b.initialTip !== null : typeof b.initialTip !== 'string' || !/^[a-f0-9]{64}$/.test(b.initialTip))) throw new Error('manifest legacy inválido');
    for (const row of b.rows) {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at)) ||
        !['plantId', 'target', 'command', 'status'].every(key => typeof row[key as keyof LegacyRow] === 'string') ||
        !['userId', 'userName', 'userEmail', 'role', 'writtenValue', 'confirmedValue', 'signature', 'prevSignature']
          .every(key => row[key as keyof LegacyRow] === null || typeof row[key as keyof LegacyRow] === 'string')) throw new Error('fila legacy inválida');
    }
    const unsigned = b.rows.filter(row => row.signature === null).map(row => row.id).sort((a, c) => a - c);
    if (new Set(b.rows.map(row => row.id)).size !== b.rows.length ||
      JSON.stringify(unsigned) !== JSON.stringify(b.unsignedIds) ||
      b.rows.length - unsigned.length !== b.initialSignedCount || !selloCoincide(legacyFactsDigest(b.rows), b.factsSha256)) throw new Error('manifest legacy inconsistente');
    return b;
  }
}

/** Pin exact identities and content, including original signatures and NULL seals. */
export function compareLegacyBoundary(boundary: ReviewedLegacyBoundary, current: LegacyRow[]): EslabonRoto[] {
  const byId = new Map(current.map(row => [row.id, row]));
  const originalIds = new Set(boundary.rows.map(row => row.id));
  const maxId = boundary.rows.reduce((max, row) => Math.max(max, row.id), 0);
  const broken: EslabonRoto[] = [];
  for (const original of boundary.rows) {
    const row = byId.get(original.id);
    if (!row || JSON.stringify(projection(original)) !== JSON.stringify(projection(row))) {
      broken.push({ id: original.id, plantId: original.plantId, at: original.at, motivo: 'limite_legacy_no_coincide' });
    }
  }
  for (const row of current) if (row.id <= maxId && !originalIds.has(row.id)) {
    // Recipient comes from trusted boundary evidence, not the injected row's plant.
    const trusted = boundary.rows[0];
    broken.push({ id: trusted.id, plantId: trusted.plantId, at: trusted.at, motivo: 'limite_legacy_no_coincide' });
  }
  return broken;
}
