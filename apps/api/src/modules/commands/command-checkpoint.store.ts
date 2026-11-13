import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { selloCoincide } from './command-signature';

interface CheckpointFacts {
  count: number;
  tip: string | null;
  last: { id: number; plantId: string; at: string } | null;
}
export type CommandCheckpoint = CheckpointFacts & ({ version: 1 } | { version: 2; legacyBoundarySha256: string });

/** Separate host identity/ACL from the MySQL account. Never bootstrap from database contents. */
export class CommandCheckpointStore {
  readonly path: string;
  constructor(private readonly secret: string, path = process.env.COMMAND_CHECKPOINT_PATH ||
    join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'state'), 'monitor-ptap', 'command-ledger', 'checkpoint.json')) {
    this.path = path;
  }

  // O_EXCL also excludes other workers. Contention/crash leaves operations unverified, never
  // an unlocked fallback. An operator must review a stranded lock before removing it.
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = await open(`${this.path}.lock`, 'wx', 0o600);
    try { return await operation(); }
    finally { await lock.close(); await unlink(`${this.path}.lock`); }
  }

  async read(): Promise<CommandCheckpoint> {
    const envelope = JSON.parse(await readFile(this.path, 'utf8')) as { checkpoint: CommandCheckpoint; mac: string };
    const c = envelope.checkpoint;
    if (!c || (c.version !== 1 && c.version !== 2) ||
      (c.version === 2 && (typeof c.legacyBoundarySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.legacyBoundarySha256))) ||
      !Number.isSafeInteger(c.count) || c.count < 0 ||
      (c.count === 0 ? c.tip !== null || c.last !== null :
        typeof c.tip !== 'string' || !/^[a-f0-9]{64}$/.test(c.tip) || !c.last ||
        !Number.isSafeInteger(c.last.id) || typeof c.last.plantId !== 'string' || typeof c.last.at !== 'string') ||
      typeof envelope.mac !== 'string' || !selloCoincide(this.mac(c), envelope.mac)) {
      throw new Error('checkpoint ausente, inválido o no autenticado');
    }
    return c;
  }

  async exists(): Promise<boolean> {
    try { await readFile(this.path); return true; }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false; throw err; }
  }

  /** Caller holds exclusive lock; sync temp bytes before atomically replacing the prior anchor. */
  async write(checkpoint: CommandCheckpoint): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({ checkpoint, mac: this.mac(checkpoint) }));
      await file.sync();
    } finally { await file.close(); }
    try { await rename(temporary, this.path); }
    finally { await unlink(temporary).catch(() => {}); }
  }

  private mac(checkpoint: CommandCheckpoint): string {
    return createHmac('sha256', this.secret).update(`ptap-command-checkpoint-v${checkpoint.version}\n`)
      .update(JSON.stringify(checkpoint)).digest('hex');
  }
}
