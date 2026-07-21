import { Module } from '@nestjs/common';
import { AuthModule } from '../../modules/auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ConnectionEventsSubscriber } from '../audit/connection-events.subscriber';
import { LoggingModule } from '../logging/logging.module';
import { StructuredEventsSubscriber } from '../logging/structured-events.subscriber';
import { MetricsModule } from '../metrics/metrics.module';
import { OpcMetricsSubscriber } from '../metrics/opc-metrics.subscriber';
import { ConnectivityModule } from './connectivity.module';
import { DiagnosticsController } from './diagnostics.controller';
import { OpcController } from './opc.controller';

/**
 * Observabilidad Fase 4 del puente OPC UA: /api/opc/* con RBAC, audit log de conexión,
 * métricas y logging estructurado. Requiere MySQL (vía AuthModule/AuditModule) —
 * separado de ConnectivityModule (Fase 1-3, sin BD) para que main.telemetry.ts pueda
 * seguir arrancando sin base de datos importando solo ConnectivityModule.
 */
@Module({
  imports: [ConnectivityModule, AuthModule, AuditModule, MetricsModule, LoggingModule],
  controllers: [OpcController, DiagnosticsController],
  providers: [ConnectionEventsSubscriber, OpcMetricsSubscriber, StructuredEventsSubscriber],
})
export class OpcObservabilityModule {}
