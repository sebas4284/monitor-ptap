import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { MappingController } from './mapping.controller';
import { MappingOverrideRepository } from './mapping-override.repository';
import { MappingOverrideService } from './mapping-override.service';

/**
 * Edición del mapeo desde la app (modo desarrollador).
 *
 * Importa ConnectivityModule para EMPUJAR las correcciones al pipeline, no al revés: el pipeline no
 * puede depender de MySQL porque `main.telemetry.ts` lo arranca sin base de datos. La dirección de
 * esta flecha es lo que mantiene viva esa separación.
 */
@Module({
  imports: [ConnectivityModule, DatabaseModule, AuthModule],
  controllers: [MappingController],
  providers: [MappingOverrideRepository, MappingOverrideService],
  exports: [MappingOverrideService],
})
export class MappingModule {}
