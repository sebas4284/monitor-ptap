import { Body, Controller, Delete, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import { plantIdParamSchema } from '../../infrastructure/validation/plant-id.schema';
import { domainKeyParamSchema, mappingPatchSchema, type MappingPatchBody } from './mapping-patch.schema';
import { MappingOverrideService } from './mapping-override.service';

/**
 * Editar el mapeo desde la app. **Todo exige `system_config`** (solo admin), igual que el resto de
 * `/api/opc/*`: esto no configura una preferencia, decide qué número del PLC es el nivel del tanque.
 *
 * Ocultar el botón en la app es comodidad de interfaz; quien decide es este guard.
 */
@Controller('opc/mapping')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MappingController {
  constructor(private readonly overrides: MappingOverrideService) {}

  /** Las correcciones en vigor, de todas las plantas. */
  @Get()
  @RequirePermission('system_config')
  listar() {
    return this.overrides.listar().then((overrides) => ({ overrides }));
  }

  /** Las señales de una planta como las ve el editor: lo que rige, de dónde sale y qué se le tocó. */
  @Get(':plantId')
  @RequirePermission('system_config')
  planta(@Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string) {
    return this.overrides.planta(plantId);
  }

  /** Quién tocó esta señal y cuándo. Nada se borra, así que la lista es la historia completa. */
  @Get(':plantId/:domainKey/historial')
  @RequirePermission('system_config')
  historial(
    @Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string,
    @Param('domainKey', new ZodValidationPipe(domainKeyParamSchema)) domainKey: string,
  ) {
    return this.overrides.historial(plantId, domainKey).then((historial) => ({ historial }));
  }

  /**
   * Corrige la señal y lo aplica en el momento, sin reiniciar el proceso.
   *
   * Devuelve la señal como queda, para que la pantalla pinte el resultado real y no lo que el
   * usuario escribió: si el servidor ajustó o rechazó algo, se ve.
   */
  @Patch(':plantId/:domainKey')
  @RequirePermission('system_config')
  aplicar(
    @Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string,
    @Param('domainKey', new ZodValidationPipe(domainKeyParamSchema)) domainKey: string,
    @Body(new ZodValidationPipe(mappingPatchSchema)) patch: MappingPatchBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.overrides.aplicar(plantId, domainKey, patch, request.user);
  }

  /** Vuelve al mapeo del repositorio. No borra el registro: inserta la reversión. */
  @Delete(':plantId/:domainKey')
  @RequirePermission('system_config')
  revertir(
    @Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string,
    @Param('domainKey', new ZodValidationPipe(domainKeyParamSchema)) domainKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.overrides.revertir(plantId, domainKey, request.user);
  }
}
