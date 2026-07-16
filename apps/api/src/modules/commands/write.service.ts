import { Inject, Injectable, Logger } from '@nestjs/common';
import { hasPermission, type Permission, type Role } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import { CONNECTIVITY_ADAPTER, CONNECTIVITY_CONFIG } from '../../infrastructure/connectivity/connectivity.tokens';
import type { ConnectivityConfig } from '../../infrastructure/connectivity/connectivity.config';
import type { WriteSpec } from '../../infrastructure/connectivity/mapping/opc-mapping.loader';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import type { BufferElementTarget, ConnectivityAdapter } from '../../infrastructure/connectivity/ports/connectivity-adapter.port';
import { CommandLogRepository, type CommandValue, type StoredCommand } from './command-log.repository';
import { CommandMappingResolver } from './command-mapping.resolver';
import {
  FAIL,
  REJECT,
  httpStatusForCommand,
  type CommandActor,
  type CommandOutcome,
  type CommandRequest,
  type CommandResult,
} from './command.dto';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * WriteService (Fase 5): único punto que ejecuta comandos de escritura al PLC.
 *
 * PRECONDICIÓN DURA (regla 9): rechaza TODO si OPCUA_WRITES_ENABLED=false o si la sesión
 * no es autenticada+cifrada — sin excepciones, ni "para probar". Flujo por comando:
 * resolver target → verbo válido → precondición segura → RBAC (permiso del mapping) →
 * interlock (bridge Connected + snapshot fresco) → idempotencia (insert-pending-first) →
 * write → read-back con timeout → confirmado|fallido (+ rollback best-effort) → audit SIEMPRE.
 */
@Injectable()
export class WriteService {
  private readonly logger = new Logger('WriteService');

  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(CONNECTIVITY_CONFIG) private readonly config: ConnectivityConfig,
    @Inject(PlantCache) private readonly cache: PlantCache,
    @Inject(CommandMappingResolver) private readonly resolver: CommandMappingResolver,
    @Inject(CommandLogRepository) private readonly repo: CommandLogRepository,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async execute(plantId: string, req: CommandRequest, actor: CommandActor): Promise<CommandResult> {
    const base = {
      plantId,
      target: req.target,
      command: req.command,
      previousValue: null as CommandValue,
      writtenValue: null as CommandValue,
      confirmedValue: null as CommandValue,
      interlockSequence: null as number | null,
      idempotent: false,
      at: new Date().toISOString(),
    };
    const reject = (reason: string): CommandResult => ({ ...base, status: 'rejected', reason });

    // 1) Resolver el target a una señal writable + write spec (regla 2).
    const resolved = this.resolver.resolve(plantId, req.target);
    if (!resolved) return this.audit(actor, req, await this.finalizeNoReserve(reject(REJECT.TARGET_NOT_WRITABLE)));
    const write = resolved.write;

    // 2) El verbo debe existir en el mapping.
    if (!(req.command in write.commands)) {
      return this.audit(actor, req, await this.finalizeNoReserve(reject(REJECT.UNKNOWN_COMMAND)));
    }

    // 3) PRECONDICIÓN DURA: writes habilitados Y sesión segura (autenticada+cifrada).
    const security = this.adapter.getWriteSecurity();
    if (!this.config.opcua.writesEnabled || !security.secure) {
      return this.audit(actor, req, await this.finalizeNoReserve(reject(REJECT.WRITES_DISABLED_INSECURE_SESSION)));
    }

    // 4) RBAC dinámico: el permiso lo declara el mapping (jefe NO tiene control_valves).
    if (!actor.role || !hasPermission(actor.role as Role, write.permission as Permission)) {
      return this.audit(actor, req, await this.finalizeNoReserve(reject(REJECT.FORBIDDEN)));
    }

    // 5) Interlock: no accionar sobre un sitio desconectado o con datos congelados.
    const il = this.interlock(plantId);
    base.interlockSequence = il.sequence;
    if (!il.ok) {
      return this.audit(actor, req, await this.finalizeNoReserve({ ...reject(REJECT.INTERLOCK_FAILED), reason: `${REJECT.INTERLOCK_FAILED}: ${il.reason}` }));
    }

    // 6) Idempotencia (insert-pending-first): reserva ANTES de escribir (evita doble accionamiento).
    const reservation = await this.repo.reserve({
      idempotencyKey: req.idempotencyKey ?? null,
      plantId,
      target: req.target,
      command: req.command,
      userId: actor.userId,
      userEmail: actor.userEmail,
      role: actor.role,
      ip: actor.ip,
    });
    if (!reservation.reserved) {
      return this.audit(actor, req, this.replay(base, reservation.existing));
    }

    // 7) Ejecutar: leer valor previo → escribir → read-back con timeout.
    const writtenValue = write.commands[req.command];
    const targetEl: BufferElementTarget = {
      plantId,
      channel: write.target.channel,
      sourceBuffer: write.target.sourceBuffer,
      index: write.target.index,
    };

    let result: CommandResult;
    try {
      const prev = await this.adapter.readBufferElement(targetEl);
      base.previousValue = prev.value;
      await this.adapter.writeBufferElement(targetEl, writtenValue);
      base.writtenValue = writtenValue;

      const confirmation = await this.confirmReadBack(plantId, write, writtenValue);
      base.confirmedValue = confirmation.value;

      if (confirmation.confirmed) {
        result = { ...base, status: 'confirmed', reason: null };
      } else {
        await this.rollback(targetEl, write); // best-effort
        result = { ...base, status: 'failed', reason: FAIL.READBACK_UNCONFIRMED };
      }
    } catch (err) {
      // Un fallo de I/O tras reservar NUNCA se reporta como 'exitoso'.
      this.logger.error(`comando ${req.command}/${req.target} falló: ${err instanceof Error ? err.message : err}`);
      result = { ...base, status: 'failed', reason: FAIL.READBACK_UNCONFIRMED };
    }

    await this.repo.finalize(reservation.id, {
      status: result.status as Exclude<CommandOutcome, never>,
      reason: result.reason,
      previousValue: result.previousValue,
      writtenValue: result.writtenValue,
      confirmedValue: result.confirmedValue,
      interlockSequence: result.interlockSequence,
    });

    return this.audit(actor, req, result);
  }

  /** Interlock: BridgeStatus Connected + snapshot fresco (liveness live) + connection OK si está mapeada. */
  private interlock(plantId: string): { ok: boolean; reason: string; sequence: number | null } {
    const bridge = this.adapter.getBridgeStatus();
    if (bridge !== 'Connected') return { ok: false, reason: `bridge ${bridge} (se requiere Connected)`, sequence: null };

    const snap = this.cache.get(plantId);
    if (!snap) return { ok: false, reason: 'sin snapshot del sitio (sin datos)', sequence: null };
    if (snap.liveness.state !== 'live') {
      return { ok: false, reason: `snapshot ${snap.liveness.state} (se requiere fresco/live)`, sequence: snap.sequence };
    }
    const conn = snap.signals['connectionStatus'];
    if (conn && conn.usable === false) {
      return { ok: false, reason: 'connectionStatus del sitio no OK', sequence: snap.sequence };
    }
    return { ok: true, reason: 'ok', sequence: snap.sequence };
  }

  /** Re-lee el elemento de confirmación hasta que coincida con el valor esperado o venza el timeout. */
  private async confirmReadBack(plantId: string, write: WriteSpec, writtenValue: CommandValue): Promise<{ confirmed: boolean; value: CommandValue }> {
    const expected: CommandValue = write.readBack.confirmsWrittenValue
      ? writtenValue
      : write.readBack.expectedValue ?? writtenValue;
    const rbTarget: BufferElementTarget = {
      plantId,
      channel: write.readBack.channel,
      sourceBuffer: write.readBack.sourceBuffer ?? write.target.sourceBuffer,
      index: write.readBack.index,
    };
    const deadline = Date.now() + write.timeoutMs;
    const pollMs = Math.max(5, Math.min(50, Math.floor(write.timeoutMs / 4)));

    let last: CommandValue = null;
    do {
      const rb = await this.adapter.readBufferElement(rbTarget);
      last = rb.value;
      if (last === expected) return { confirmed: true, value: last };
      if (Date.now() >= deadline) break;
      await sleep(pollMs);
    } while (Date.now() < deadline);

    return { confirmed: false, value: last };
  }

  private async rollback(targetEl: BufferElementTarget, write: WriteSpec): Promise<void> {
    try {
      await this.adapter.writeBufferElement(targetEl, write.rollbackValue);
    } catch (err) {
      this.logger.warn(`rollback falló en ${targetEl.sourceBuffer}[${targetEl.index}]: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Reconstruye el resultado desde una fila previa (respuesta idempotente). */
  private replay(base: Omit<CommandResult, 'status' | 'reason'>, existing: StoredCommand): CommandResult {
    if (existing.status === 'pending') {
      return { ...base, status: 'rejected', reason: REJECT.IN_PROGRESS, idempotent: true };
    }
    return {
      ...base,
      status: existing.status as CommandOutcome,
      reason: existing.reason,
      previousValue: existing.previousValue,
      writtenValue: existing.writtenValue,
      confirmedValue: existing.confirmedValue,
      interlockSequence: existing.interlockSequence,
      idempotent: true,
    };
  }

  /** Los rechazos previos a la reserva no crean fila en command_log; devuelven el resultado tal cual. */
  private async finalizeNoReserve(result: CommandResult): Promise<CommandResult> {
    return result;
  }

  /** Audit log SIEMPRE (regla 12 + criterio de aceptación): todo intento queda registrado. */
  private async audit(actor: CommandActor, req: CommandRequest, result: CommandResult): Promise<CommandResult> {
    await this.auditLog.record({
      eventType: 'command.execute',
      userId: actor.userId,
      userEmail: actor.userEmail,
      role: actor.role,
      ip: actor.ip,
      method: 'POST',
      path: `/api/plants/${result.plantId}/commands`,
      statusCode: httpStatusForCommand(result),
      detail: {
        command: result.command,
        target: result.target,
        status: result.status,
        reason: result.reason,
        previousValue: result.previousValue,
        writtenValue: result.writtenValue,
        confirmedValue: result.confirmedValue,
        interlockSequence: result.interlockSequence,
        idempotencyKey: req.idempotencyKey ?? null,
        idempotent: result.idempotent,
      },
    });
    return result;
  }
}
