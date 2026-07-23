import { Module } from '@nestjs/common';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { AuthModule } from '../auth/auth.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Informes por métrica (CSV de exportación). Importa ConnectivityModule (PlantCache, de donde se
 * muestrea la telemetría en RAM) y AuthModule (guards). Requiere BD solo por los guards de auth;
 * los informes en sí NO tocan MySQL (van a archivos en disco).
 */
@Module({
  imports: [ConnectivityModule, AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
