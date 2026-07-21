import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { AuditModule } from '../infrastructure/audit/audit.module';
import { AuditMiddleware } from '../infrastructure/audit/audit.middleware';
import { LoggingModule } from '../infrastructure/logging/logging.module';
import { MetricsModule } from '../infrastructure/metrics/metrics.module';
import { OpcObservabilityModule } from '../infrastructure/connectivity/opc-observability.module';
import { AuthModule } from './auth/auth.module';
import { CommandsModule } from './commands/commands.module';
import { HealthModule } from './health/health.module';
import { PlantsModule } from './plants/plants.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    LoggingModule,
    MetricsModule,
    OpcObservabilityModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PlantsModule,
    CommandsModule,
  ],
})
export class AppModule implements NestModule {
  // Auditoría de accesos (permitidos y denegados) a rutas protegidas. Solo se monta aquí
  // (arranque completo con MySQL); main.telemetry.ts nunca importa AppModule → sigue sin BD.
  // El filtrado por prefijo vive en AuditMiddleware, evitando el gotcha de forRoutes con el
  // prefijo global 'api'.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditMiddleware).forRoutes('*');
  }
}
