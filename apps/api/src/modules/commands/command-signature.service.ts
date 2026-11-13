import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';
import { CommandCheckpointStore, type CommandCheckpoint } from './command-checkpoint.store';
import { CommandLegacyBoundaryStore, compareLegacyBoundary, legacyFactsDigest, type LegacyRow, type ReviewedLegacyBoundary, type LegacyBoundaryExpectation } from './command-legacy-boundary';
import { firmaCorta, sellar, selloCoincide, verificarCadena, type CommandFacts, type EslabonRoto } from './command-signature';

type SignedRow = CommandFacts & { signature: string; prevSignature: string | null };
export interface CommandVerification {
  firmadas: number;
  rotos: EslabonRoto[];
  verificable: boolean;
  motivo?: string;
  legado?: { total: number; sinFirma: number; conservado: boolean; autenticidad: 'no_demostrada' };
  desdeActivacion?: { firmadas: number; verificable: boolean; integra: boolean };
}
const FIELDS = 'id, at, plant_id, target, command, status, user_id, user_name, user_email, role, written_value, confirmed_value, signature, prev_signature';

@Injectable()
export class CommandSignatureService {
  private readonly logger = new Logger('CommandSignature');
  private readonly secreto: string;
  private readonly checkpoint: CommandCheckpointStore;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {
    const propio = process.env.COMMAND_SIGNING_SECRET?.trim();
    const jwt = process.env.JWT_SECRET?.trim();
    this.secreto = propio || jwt || '';
    this.checkpoint = new CommandCheckpointStore(this.secreto);
    if (!propio && jwt) this.logger.warn('COMMAND_SIGNING_SECRET no definido: rotar JWT_SECRET invalidaría firmas y checkpoint.');
    if (!this.secreto) this.logger.error('Sin secreto de firma: el histórico no será verificable.');
  }

  /** Queue within this process, exclusive host file across processes. Never fall back unlocked. */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.pending.then(() => this.checkpoint.exclusive(operation));
    this.pending = run.catch(() => {});
    return run;
  }

  /** Signing errors cannot undo an already executed physical command. */
  async firmar(commandLogId: number, userName: string | null, finalize?: () => Promise<void>): Promise<string | null> {
    // Physical IO has already happened. Persist its outcome exactly once even if
    // the checkpoint/lock is unavailable, while returning a visible unsigned result.
    let finalizationStarted = false;
    const complete = async () => {
      if (finalize && !finalizationStarted) { finalizationStarted = true; await finalize(); }
    };
    try {
      if (!this.secreto) { await complete(); return null; }
      return await this.exclusive(async () => {
        // Keep other live completions pending until their own turn. Never exempt
        // arbitrary finalized unsigned rows to work around concurrent completions.
        await complete();
        const anchor = await this.checkpoint.read();
        const legacy = anchor.version === 2 ? await this.legacyStore().read(anchor.legacyBoundarySha256) : null;
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          const [all] = await conn.query<RowDataPacket[]>(`SELECT ${FIELDS} FROM command_log ORDER BY id ASC FOR UPDATE`);
          const boundaryErrors = legacy ? compareLegacyBoundary(legacy, all.map(aLegacyRow)) : [];
          const { signed, rotos } = this.inspect(all, true, new Set(legacy?.unsignedIds ?? []));
          const errors = rotos.filter(error => !(error.id === commandLogId && error.motivo === 'firma_ausente' && !legacy?.unsignedIds.includes(error.id)));
          if (boundaryErrors.length || errors.length || signed.length !== anchor.count || (signed.at(-1)?.signature ?? null) !== anchor.tip) throw new Error('cadena completa o frontera distinta del checkpoint');
          if (legacy?.unsignedIds.includes(commandLogId)) throw new Error('no se firman retrospectivamente maniobras legacy');
          const [filas] = await conn.query<RowDataPacket[]>(`SELECT ${FIELDS} FROM command_log WHERE id = ? FOR UPDATE`, [commandLogId]);
          const fila = filas[0];
          if (!fila) throw new Error('maniobra ausente');
          if (fila.status === 'pending') throw new Error('maniobra aún pendiente, no se firma');
          if (fila.signature !== null && fila.signature !== undefined) {
            if (!selloCoincide(sellar(aHechos(fila), fila.prev_signature as string | null, this.secreto), fila.signature as string)) throw new Error('firma previa inválida');
            await conn.rollback();
            return firmaCorta(fila.signature as string);
          }
          if (userName !== null) {
            await conn.query('UPDATE command_log SET user_name = ? WHERE id = ?', [userName, commandLogId]);
            fila.user_name = userName;
          }
          const facts = aHechos(fila);
          const signature = sellar(facts, anchor.tip, this.secreto);
          await conn.query('UPDATE command_log SET signature = ?, prev_signature = ?, signed_at = NOW(3) WHERE id = ?', [signature, anchor.tip, commandLogId]);
          await conn.commit();
          // SQL and filesystem cannot commit atomically. If this write fails or the host stops,
          // the old anchor remains: verification/signing fail closed until operator review.
          await this.checkpoint.write({ ...anchor, count: anchor.count + 1, tip: signature,
            last: { id: facts.id, plantId: facts.plantId, at: facts.at } });
          return firmaCorta(signature);
        } catch (err) {
          await conn.rollback().catch(() => {});
          throw err;
        } finally { conn.release(); }
      });
    } catch (err) {
      await complete().catch(() => this.logger.error(`no se pudo conservar la finalización de la maniobra ${commandLogId}`));
      this.logger.error(`no se pudo firmar la maniobra ${commandLogId}: ${err instanceof Error ? err.message : 'fallo de integridad'}`);
      return null;
    }
  }

  async verificar(): Promise<CommandVerification> {
    if (!this.secreto) return { firmadas: 0, rotos: [], verificable: false, motivo: 'sin_secreto' };
    try {
      return await this.exclusive(async () => {
        const anchor = await this.checkpoint.read();
        const legacy = anchor.version === 2 ? await this.legacyStore().read(anchor.legacyBoundarySha256) : null;
        const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT ${FIELDS} FROM command_log ORDER BY id ASC`);
        const { signed, rotos } = this.inspect(rows, true, new Set(legacy?.unsignedIds ?? []));
        const boundaryErrors = legacy ? compareLegacyBoundary(legacy, rows.map(aLegacyRow)) : [];
        rotos.push(...boundaryErrors);
        if (signed.length !== anchor.count || (signed.at(-1)?.signature ?? null) !== anchor.tip) {
          const last = anchor.last ?? signed.at(-1);
          if (last) rotos.push({ id: last.id, plantId: last.plantId, at: last.at, motivo: 'checkpoint_no_coincide' });
          else throw new Error('checkpoint no coincide');
        }
        return { firmadas: signed.length, rotos, verificable: true,
          ...(legacy ? {
            legado: { total: legacy.rows.length, sinFirma: legacy.unsignedIds.length, conservado: boundaryErrors.length === 0, autenticidad: 'no_demostrada' as const },
            desdeActivacion: { firmadas: Math.max(0, signed.length - legacy.initialSignedCount), verificable: true, integra: rotos.length === 0 },
          } : {}),
        };
      });
    } catch {
      return { firmadas: 0, rotos: [], verificable: false, motivo: 'checkpoint_o_lectura_no_verificados' };
    }
  }

  /** Deliberate local operator action only; never called at startup or from an HTTP route.
   * Supplied count/tip must come from independently reviewed evidence, not this DB alone.
   */
  async establecerBaseline(expectedCount: number, expectedTip: string | null, acceptance: string): Promise<void> {
    if (!this.secreto || acceptance !== 'ACEPTO EL HISTORICO REVISADO') throw new Error('aceptación explícita requerida');
    await this.exclusive(async () => {
      if (await this.checkpoint.exists() || await this.legacyStore().exists()) throw new Error('no se reemplaza evidencia existente');
      const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT ${FIELDS} FROM command_log ORDER BY id ASC`);
      if (rows.some((row) => row.status === 'pending')) throw new Error('resolver reservas pendientes antes de aceptar el baseline');
      const { signed, rotos } = this.inspect(rows);
      if (rotos.length || signed.length !== expectedCount || (signed.at(-1)?.signature ?? null) !== expectedTip) {
        throw new Error('histórico distinto de la evidencia aceptada o firmas incompletas');
      }
      const last = signed.at(-1);
      const checkpoint: CommandCheckpoint = { version: 1, count: expectedCount, tip: expectedTip,
        last: last ? { id: last.id, plantId: last.plantId, at: last.at } : null };
      await this.checkpoint.write(checkpoint);
    });
  }

  private legacyStore(): CommandLegacyBoundaryStore { return new CommandLegacyBoundaryStore(this.secreto, this.checkpoint.path); }

  /** Explicit alternative to v1 acceptance: preserves unsigned legacy and never authenticates it. */
  async establecerFronteraLegacy(expected: LegacyBoundaryExpectation, acceptance: string): Promise<void> {
    if (!this.secreto || acceptance !== 'ACEPTO LA FRONTERA LEGACY SIN AUTENTICIDAD RETROACTIVA') throw new Error('aceptación legacy explícita requerida');
    if (!Number.isSafeInteger(expected.total) || expected.total < 1 || !Number.isSafeInteger(expected.unsigned) || expected.unsigned < 1 ||
      !Number.isSafeInteger(expected.count) || expected.count < 0 || expected.count + expected.unsigned !== expected.total ||
      !/^[a-f0-9]{64}$/.test(expected.factsSha256) ||
      (expected.count === 0 ? expected.tip !== null : typeof expected.tip !== 'string' || !/^[a-f0-9]{64}$/.test(expected.tip))) throw new Error('evidencia esperada inválida');
    await this.exclusive(async () => {
      const store = this.legacyStore();
      if (await this.checkpoint.exists() || await store.exists()) throw new Error('no se reemplaza evidencia previa');
      const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT ${FIELDS} FROM command_log ORDER BY id ASC`);
      if (rows.some(row => row.status === 'pending')) throw new Error('resolver reservas pendientes');
      const legacyRows = rows.map(aLegacyRow);
      if (legacyRows.some(row => !Number.isSafeInteger(row.id) || row.id < 1) || new Set(legacyRows.map(row => row.id)).size !== legacyRows.length) throw new Error('identidades legacy inválidas');
      const unsignedIds = legacyRows.filter(row => row.signature === null).map(row => row.id).sort((a, b) => a - b);
      const { signed, rotos } = this.inspect(rows, false, new Set(unsignedIds));
      if (rotos.length || rows.length !== expected.total || unsignedIds.length !== expected.unsigned || signed.length !== expected.count ||
        (signed.at(-1)?.signature ?? null) !== expected.tip || !selloCoincide(legacyFactsDigest(legacyRows), expected.factsSha256)) throw new Error('frontera distinta de evidencia revisada');
      const boundary: ReviewedLegacyBoundary = { version: 1, acceptedAt: new Date().toISOString(), factsSha256: expected.factsSha256,
        unsignedIds, initialSignedCount: signed.length, initialTip: expected.tip, rows: legacyRows };
      const legacyBoundarySha256 = await store.create(boundary);
      const last = signed.at(-1);
      await this.checkpoint.write({ version: 2, legacyBoundarySha256, count: signed.length, tip: expected.tip,
        last: last ? { id: last.id, plantId: last.plantId, at: last.at } : null });
    });
  }

  private inspect(rows: RowDataPacket[], allowPending = false, legacyUnsigned = new Set<number>()): { signed: SignedRow[]; rotos: EslabonRoto[] } {
    const signed: SignedRow[] = [];
    const unsigned: EslabonRoto[] = [];
    for (const row of rows) {
      // reserve() precedes physical IO and finalize(). A currently pending unsigned reservation
      // is not a completed command yet. Removing a previously signed row's seal and relabelling
      // it pending still disagrees with the authenticated count/tip in verificar(). Baseline
      // acceptance deliberately does not allow these in-flight reservations.
      if (allowPending && row.status === 'pending' && row.signature === null) continue;
      if (legacyUnsigned.has(Number(row.id)) && row.signature === null) continue;
      const facts = aHechos(row);
      if (typeof row.signature !== 'string' || !/^[a-f0-9]{64}$/.test(row.signature)) {
        unsigned.push({ id: facts.id, plantId: facts.plantId, at: facts.at, motivo: 'firma_ausente' });
      } else signed.push({ ...facts, signature: row.signature, prevSignature: row.prev_signature as string | null });
    }
    // Completion order differs from command IDs. Walk signed links, including orphan/fork rows;
    // never drop a row just because it is not reachable from GENESIS.
    const byPrevious = new Map<string | null, SignedRow[]>();
    for (const row of signed) {
      const key = row.prevSignature ?? null;
      const list = byPrevious.get(key) ?? [];
      list.push(row);
      byPrevious.set(key, list);
    }
    const ordered: SignedRow[] = [];
    const seen = new Set<SignedRow>();
    const walk = (start: SignedRow) => {
      let next: SignedRow | undefined = start;
      while (next && !seen.has(next)) {
        seen.add(next); ordered.push(next);
        next = byPrevious.get(next.signature)?.find((row) => !seen.has(row));
      }
    };
    for (const genesis of byPrevious.get(null) ?? []) walk(genesis);
    for (const row of signed) if (!seen.has(row)) walk(row);
    return { signed: ordered, rotos: [...unsigned, ...verificarCadena(ordered, this.secreto)] };
  }
}

function aLegacyRow(row: RowDataPacket): LegacyRow {
  return { ...aHechos(row), signature: (row.signature as string | null) ?? null, prevSignature: (row.prev_signature as string | null) ?? null };
}

function aHechos(f: RowDataPacket): CommandFacts {
  const at = f.at as Date | string;
  return {
    id: f.id as number,
    at: at instanceof Date ? at.toISOString() : new Date(at).toISOString(),
    plantId: f.plant_id as string, target: f.target as string, command: f.command as string,
    status: f.status as string, userId: (f.user_id as string | null) ?? null,
    userName: (f.user_name as string | null) ?? null, userEmail: (f.user_email as string | null) ?? null,
    role: (f.role as string | null) ?? null, writtenValue: (f.written_value as string | null) ?? null,
    confirmedValue: (f.confirmed_value as string | null) ?? null,
  };
}
