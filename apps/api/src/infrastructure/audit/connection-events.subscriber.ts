import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CONNECTIVITY_ADAPTER } from '../connectivity/connectivity.tokens';
import type { ConnectivityAdapter } from '../connectivity/ports/connectivity-adapter.port';
import { AuditLogService } from './audit-log.service';

/**
 * Registra en audit_log cada transición de BridgeStatus (regla 11: "las transiciones
 * se registran"). Se cuelga del hook público onStatusChange (ya usado también por
 * BridgeOrchestratorService para el log en vivo) — no toca nada interno del adapter.
 */
@Injectable()
export class ConnectionEventsSubscriber implements OnModuleInit {
  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  onModuleInit(): void {
    this.adapter.onStatusChange((status, reason) => {
      void this.auditLog.record({
        eventType: 'opc.bridge_status_change',
        userId: null,
        userEmail: null,
        role: null,
        ip: null,
        method: null,
        path: null,
        statusCode: null,
        detail: { status, reason },
      });
    });
  }
}
