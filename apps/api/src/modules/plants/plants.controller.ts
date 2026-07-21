import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import { plantIdParamSchema } from '../../infrastructure/validation/plant-id.schema';

/**
 * REST del pipeline de dominio (PASO 3.7). Responde SIEMPRE desde la cache RAM; NUNCA
 * toca el PLC bajo demanda (< 50 ms). Reemplaza el listado legado (que salía del
 * ConnectivityService por poll) por la lista con liveness real del puente crudo.
 *
 * RBAC (Fase 4): solo exige JWT válido (sin @RequirePermission) — cualquier rol autenticado
 * lee. NOTA de divergencia con la matriz oficial: el Civil hoy ve el snapshot detallado;
 * la matriz dice que solo debería ver estado básico ("hay agua"). Restringirlo requiere un
 * endpoint de estado básico y tocar el móvil — decisión de producto pendiente (ver README).
 * La auditoría de accesos la aplica AuditMiddleware a nivel de app, no por ruta.
 */
@Controller('plants')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PlantsController {
  // @Inject explícito: tsx (esbuild) no emite design:paramtypes; la inyección por tipo falla en dev.
  constructor(
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(PlantCache) private readonly cache: PlantCache,
  ) {}

  /** Lista de plantas con su liveness (para el tablero). */
  @Get()
  list() {
    return { plants: this.pipeline.listPlants() };
  }

  /** Snapshot de dominio de una planta, desde cache RAM. */
  @Get(':plantId/snapshot')
  snapshot(@Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string) {
    const snapshot = this.cache.get(plantId);
    if (snapshot) return snapshot;

    // Aún sin datos: devolver el liveness conocido (unknown) en vez de un 404 ciego,
    // salvo que la planta no exista en el mapping.
    const known = this.pipeline.listPlants().find((p) => p.plantId === plantId);
    if (!known) throw new NotFoundException(`planta desconocida: ${plantId}`);
    return {
      plantId: known.plantId,
      displayName: known.displayName,
      sequence: 0,
      bridgeStatus: known.bridgeStatus,
      liveness: known.liveness,
      signals: {},
      pending: true,
    };
  }
}
