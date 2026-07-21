import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CONNECTIVITY_ADAPTER } from '../connectivity/connectivity.tokens';
import type { ConnectivityAdapter } from '../connectivity/ports/connectivity-adapter.port';
import { AuditLogService } from './audit-log.service';

/**
 * Registra en audit_log cada transición de BridgeStatus (regla 11: "las transiciones
 * se registran"). Se cuelga del hook público onStatusChange (ya usado también por
 * BridgeOrchestratorService para el log en vivo) — no toca nada interno del adapter.
 *
 * IMPORTANTE — línea base de arranque: `onStatusChange` NO reproduce el estado actual a un
 * listener nuevo, y el puente ya hace su primera transición (Disconnected → Connecting) durante
 * el arranque, ANTES de que este onModuleInit registre el listener. Sin la línea base, ese
 * primer `Connecting` se pierde — y cuando el PLC está inalcanzable el puente se queda ahí sin
 * más transiciones, así que NO se registraría NADA justo durante un corte (que es cuando el
 * admin necesita el historial). Por eso, además de escuchar, se graba el estado actual al
 * iniciar. (Verificado: antes de esto, `Connecting` nunca aparecía en el audit_log.)
 */
@Injectable()
export class ConnectionEventsSubscriber implements OnModuleInit {
  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  onModuleInit(): void {
    this.adapter.onStatusChange((status, reason) => this.record(status, reason));
    // Línea base: capta el estado en que ya está el puente al registrarnos (típicamente
    // Connecting), que la transición inicial no nos entregó por registrarnos tarde.
    this.record(this.adapter.getBridgeStatus(), 'estado del puente al iniciar el registro');
  }

  private record(status: string, reason: string): void {
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
  }
}
