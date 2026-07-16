import { z } from 'zod';
import type { CommandValue } from './command-log.repository';

/** Cuerpo de POST /api/plants/:plantId/commands. API de DOMINIO, nunca de NodeIds. */
export const commandRequestSchema = z
  .object({
    command: z.string().min(1).max(64),
    target: z.string().min(1).max(64),
    idempotencyKey: z.string().min(1).max(120).optional(),
  })
  .strict();

export type CommandRequest = z.infer<typeof commandRequestSchema>;

export type CommandOutcome = 'confirmed' | 'failed' | 'rejected';

/** Motivos de rechazo (comando NO ejecutado) y de fallo (ejecutado, sin confirmar). */
export const REJECT = {
  TARGET_NOT_WRITABLE: 'TARGET_NOT_WRITABLE',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  WRITES_DISABLED_INSECURE_SESSION: 'WRITES_DISABLED_INSECURE_SESSION',
  FORBIDDEN: 'FORBIDDEN',
  INTERLOCK_FAILED: 'INTERLOCK_FAILED',
  IN_PROGRESS: 'IN_PROGRESS',
} as const;

export const FAIL = {
  READBACK_UNCONFIRMED: 'READBACK_UNCONFIRMED',
} as const;

export interface CommandResult {
  status: CommandOutcome;
  reason: string | null;
  plantId: string;
  target: string;
  command: string;
  previousValue: CommandValue;
  writtenValue: CommandValue;
  confirmedValue: CommandValue;
  /** sequence del snapshot usado para el interlock (trazabilidad). */
  interlockSequence: number | null;
  /** true si es una respuesta idempotente (comando ya ejecutado con la misma idempotencyKey). */
  idempotent: boolean;
  at: string;
}

/** Actor autenticado que emite el comando (de request.user + IP). */
export interface CommandActor {
  userId: string | null;
  userEmail: string | null;
  role: string | null;
  ip: string | null;
}

/**
 * Código HTTP para un resultado de comando. confirmado→200; fallido (ejecutado sin confirmar
 * read-back)→502 (nunca 2xx: regla "sin read-back confirmado → fallido"); rechazos→4xx.
 */
export function httpStatusForCommand(result: CommandResult): number {
  if (result.status === 'confirmed') return 200;
  if (result.status === 'failed') return 502;
  const reason = result.reason ?? '';
  if (reason === REJECT.FORBIDDEN || reason === REJECT.WRITES_DISABLED_INSECURE_SESSION) return 403;
  if (reason === REJECT.UNKNOWN_COMMAND) return 400;
  if (reason.startsWith(REJECT.INTERLOCK_FAILED) || reason === REJECT.IN_PROGRESS) return 409;
  if (reason === REJECT.TARGET_NOT_WRITABLE) return 404;
  return 400;
}
