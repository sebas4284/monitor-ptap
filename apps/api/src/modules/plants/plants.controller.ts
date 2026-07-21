import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PlantScopeGuard } from '../auth/guards/plant-scope.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import { toBasicStatus, type PlantBasicStatusDto } from '../../infrastructure/connectivity/pipeline/plant-basic-status.dto';
import type { BridgeStatus } from '../../infrastructure/connectivity/ports/connectivity-adapter.port';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import { plantIdParamSchema } from '../../infrastructure/validation/plant-id.schema';

/**
 * REST del pipeline de dominio (PASO 3.7). Responde SIEMPRE desde la cache RAM; NUNCA
 * toca el PLC bajo demanda (< 50 ms).
 *
 * RBAC (Fase 4) según la matriz oficial:
 *  - Datos detallados (`/snapshot`) exigen `view_dashboard` → el Civil recibe 403.
 *  - El estado básico (`/status`) exige `view_basic_status`, que TODOS los roles tienen: es
 *    lo único que la matriz concede al Civil, y viaja en un DTO propio SIN `signals`.
 *  - `PlantScopeGuard` acota además POR PLANTA: cada cuenta ve solo la suya (`user.plant`),
 *    salvo con `view_all_plants` (Admin). El `@Get()` de listado no lleva `:plantId`, así que
 *    ese guard lo deja pasar.
 * La restricción es por whitelist (un DTO mínimo aparte), no recortando el snapshot: así el
 * contrato de `/snapshot` sigue intacto para operador/jefe/admin y ningún dato detallado
 * puede escaparse por descuido hacia el Civil.
 * La auditoría de accesos la aplica AuditMiddleware a nivel de app, no por ruta.
 */
@Controller('plants')
@UseGuards(JwtAuthGuard, PermissionGuard, PlantScopeGuard)
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

  /**
   * Estado BÁSICO de una planta (rol Civil incluido): "¿opera?" y "¿hay agua?". Devuelve un
   * DTO mínimo sin `signals` — el Civil nunca recibe caudales, presiones ni válvulas.
   */
  @Get(':plantId/status')
  @RequirePermission('view_basic_status')
  basicStatus(
    @Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string,
  ): PlantBasicStatusDto {
    const snapshot = this.cache.get(plantId);
    if (snapshot) return toBasicStatus(snapshot);

    // Aún sin datos: devolver el estado conocido del puente en vez de un 404 ciego, igual
    // que hace /snapshot; sin lecturas de tanque el agua es null (nunca un falso "hay agua").
    const known = this.pipeline.listPlants().find((p) => p.plantId === plantId);
    if (!known) throw new NotFoundException(`planta desconocida: ${plantId}`);
    return {
      plantId: known.plantId,
      displayName: known.displayName,
      // listPlants() ensancha el tipo a `string`, pero el valor viene de
      // adapter.getBridgeStatus(), que es BridgeStatus por construcción.
      bridgeStatus: known.bridgeStatus as BridgeStatus,
      liveness: known.liveness,
      waterAvailable: null,
    };
  }

  /** Snapshot de dominio detallado, desde cache RAM. Datos técnicos → NO para el Civil. */
  @Get(':plantId/snapshot')
  @RequirePermission('view_dashboard')
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
