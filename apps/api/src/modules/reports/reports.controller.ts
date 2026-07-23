import { Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PlantScopeGuard } from '../auth/guards/plant-scope.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import { plantIdParamSchema } from '../../infrastructure/validation/plant-id.schema';
import { ReportsService, type ReportInfo } from './reports.service';

/**
 * Informes por métrica (CSV de exportación; NO tocan MySQL). RBAC:
 *  - `list` exige `view_dashboard` (operador/jefe/admin ven el estado de los informes).
 *  - `generate`/`download` exigen `export_data` (solo admin — la matriz reserva la exportación).
 *  - `PlantScopeGuard` acota por planta (cada cuenta solo la suya, salvo `view_all_plants`).
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionGuard, PlantScopeGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  /** Métricas de la planta con el estado de su informe (idle/collecting/ready). */
  @Get(':plantId')
  @RequirePermission('view_dashboard')
  list(@Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string): { reports: ReportInfo[] } {
    return { reports: this.reports.list(plantId) };
  }

  /** Dispara la recolección (1 muestra/min por 1 h). 409 si ya hay una en curso de ese informe. */
  @Post(':plantId/:metric/generate')
  @RequirePermission('export_data')
  @HttpCode(202)
  generate(
    @Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string,
    @Param('metric') metric: string,
  ): { status: 'collecting'; plantId: string; metric: string } {
    this.reports.generate(plantId, metric);
    return { status: 'collecting', plantId, metric };
  }

  /** Descarga el último CSV listo. Es responsabilidad del usuario descargarlo antes de que el
   *  siguiente (auto o manual) lo reemplace. 404 si aún no hay archivo. */
  @Get(':plantId/:metric/download')
  @RequirePermission('export_data')
  download(
    @Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string,
    @Param('metric') metric: string,
    @Res() res: Response,
  ): void {
    const path = this.reports.filePath(plantId, metric);
    if (!path) throw new NotFoundException('Aún no hay un informe generado para descargar.');
    res.download(path, this.reports.fileName(plantId, metric));
  }
}
