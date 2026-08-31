import { Module } from '@nestjs/common';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommandLogRepository } from './command-log.repository';
import { CommandSignatureController } from './command-signature.controller';
import { CommandSignatureService } from './command-signature.service';
import { SignatureIntegrityDetector } from './signature-integrity.detector';
import { CommandMappingResolver } from './command-mapping.resolver';
import { CommandsController } from './commands.controller';
import { WriteService } from './write.service';
import { ChannelProbeController } from './channel-probe.controller';
import { ChannelProbeService } from './channel-probe.service';

/**
 * Fase 5 — canal de escritura. Requiere BD (idempotencia/traza en command_log) y Auth
 * (RBAC), por eso vive solo en el arranque completo (main.ts). main.telemetry.ts NO lo
 * importa → la demo sin BD sigue sin poder escribir, y sin requerir MySQL.
 *
 * La escritura real está triplemente cerrada: OPCUA_WRITES_ENABLED=false por defecto,
 * el WriteService exige sesión cifrada, y el mapping de producción no tiene señales writable.
 */
@Module({
  // NotificationsModule: cada maniobra deja un aviso en la bandeja, que es el registro que
  // sustituye a la confirmación eléctrica que estas plantas no dan.
  imports: [ConnectivityModule, AuthModule, AuditModule, DatabaseModule, NotificationsModule],
  controllers: [CommandsController, CommandSignatureController, ChannelProbeController],
  providers: [
    WriteService,
    ChannelProbeService,
    CommandMappingResolver,
    CommandLogRepository,
    CommandSignatureService,
    SignatureIntegrityDetector,
  ],
})
export class CommandsModule {}
