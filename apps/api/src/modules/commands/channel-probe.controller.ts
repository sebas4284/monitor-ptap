import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import { plantIdParamSchema } from '../../infrastructure/validation/plant-id.schema';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PlantScopeGuard } from '../auth/guards/plant-scope.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { CommandActor } from './command.dto';
import { CANALES_DE_SALIDA, HOLD_MS_MAX, HOLD_MS_MIN } from './channel-probe';
import { ChannelProbeService } from './channel-probe.service';

/**
 * Probador de canales: escribe un valor en una posición del PLC, lo sostiene y lo suelta.
 *
 * Existe para descubrir codificaciones de mando que el mapeo no conoce — el caso concreto es
 * Carbonero, cuyo bit de abrir/cerrar nunca se verificó. Es la herramienta de captura que pide
 * `docs/PRUEBA_VALVULA_CARBONERO.md`, y **no sustituye al testigo humano**: en un sitio sin caudal,
 * sin presión y sin palabra de estado, el software no puede confirmar que la válvula se movió. Lo
 * único que puede hacer —y hace— es escribir de forma acotada, mirar qué más se movió y dejar
 * constancia.
 *
 * `@RequirePermission('system_config')` es la puerta; el servicio exige ADEMÁS `control_valves`, la
 * sesión cifrada y `OPCUA_WRITES_ENABLED`. `PlantScopeGuard` impide sondear equipo de otra planta.
 */
const probeBodySchema = z
  .object({
    channel: z.enum(CANALES_DE_SALIDA),
    sourceBuffer: z.string().min(1).max(120),
    index: z.number().int().min(0).max(10_000),
    value: z.union([z.number().finite(), z.boolean()]),
    /** Sin valor por defecto a propósito: cuánto se sostiene una salida se decide, no se hereda. */
    holdMs: z.number().int().min(HOLD_MS_MIN).max(HOLD_MS_MAX),
  })
  .strict();

@Controller('plants/:plantId/channel-probe')
@UseGuards(JwtAuthGuard, PermissionGuard, PlantScopeGuard)
export class ChannelProbeController {
  constructor(@Inject(ChannelProbeService) private readonly probe: ChannelProbeService) {}

  @Post()
  @RequirePermission('system_config')
  async probar(
    @Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string,
    @Body(new ZodValidationPipe(probeBodySchema)) body: z.infer<typeof probeBodySchema>,
    @Req() request: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const actor: CommandActor = {
      userId: request.user?.id ?? null,
      userName: request.user?.name ?? null,
      userEmail: request.user?.email ?? null,
      role: request.user?.role ?? null,
      ip: request.ip ?? request.socket?.remoteAddress ?? null,
    };
    const result = await this.probe.probar(plantId, body, actor);
    // 200 solo si se hizo Y se soltó. Un sondeo que dejó la salida puesta NO es un éxito, y el
    // código HTTP tiene que decirlo para que ningún cliente lo trate como tal.
    const status = result.status === 'done' ? 200 : result.status === 'rejected' ? 409 : 502;
    res.status(status).json(result);
  }
}
