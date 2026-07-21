import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import { plantIdParamSchema } from '../../infrastructure/validation/plant-id.schema';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { commandRequestSchema, httpStatusForCommand, type CommandActor, type CommandRequest } from './command.dto';
import { WriteService } from './write.service';

/**
 * Canal de comandos (Fase 5). API de DOMINIO (plantId + command + target), nunca de NodeIds.
 * RBAC: el guard exige JWT válido; el PERMISO específico (control_valves, etc.) lo declara el
 * mapping y lo valida el WriteService de forma dinámica (un jefe puede reconocer alarmas pero
 * NO abrir válvulas). Toda la seguridad dura (writes habilitados + sesión cifrada) e interlocks
 * viven en el WriteService. Se responde SIEMPRE con el resultado estructurado y su código HTTP.
 */
@Controller('plants/:plantId/commands')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CommandsController {
  constructor(@Inject(WriteService) private readonly writeService: WriteService) {}

  @Post()
  async execute(
    @Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string,
    @Body(new ZodValidationPipe(commandRequestSchema)) body: CommandRequest,
    @Req() request: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const actor: CommandActor = {
      userId: request.user?.id ?? null,
      userEmail: request.user?.email ?? null,
      role: request.user?.role ?? null,
      ip: request.ip ?? request.socket?.remoteAddress ?? null,
    };
    const result = await this.writeService.execute(plantId, body, actor);
    res.status(httpStatusForCommand(result)).json(result);
  }
}
