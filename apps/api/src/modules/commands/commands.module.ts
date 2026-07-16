import { Module } from '@nestjs/common';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CommandLogRepository } from './command-log.repository';
import { CommandMappingResolver } from './command-mapping.resolver';
import { CommandsController } from './commands.controller';
import { WriteService } from './write.service';

/**
 * Fase 5 — canal de escritura. Requiere BD (idempotencia/traza en command_log) y Auth
 * (RBAC), por eso vive solo en el arranque completo (main.ts). main.telemetry.ts NO lo
 * importa → la demo sin BD sigue sin poder escribir, y sin requerir MySQL.
 *
 * La escritura real está triplemente cerrada: OPCUA_WRITES_ENABLED=false por defecto,
 * el WriteService exige sesión cifrada, y el mapping de producción no tiene señales writable.
 */
@Module({
  imports: [ConnectivityModule, AuthModule, AuditModule, DatabaseModule],
  controllers: [CommandsController],
  providers: [WriteService, CommandMappingResolver, CommandLogRepository],
})
export class CommandsModule {}
