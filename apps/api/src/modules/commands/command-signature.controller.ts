import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CommandSignatureService } from './command-signature.service';
import type { EslabonRoto } from './command-signature';

/**
 * Verificación del libro de firmas de maniobras.
 *
 * Existe para que la cadena sirva de algo: firmar sin poder comprobar la firma es teatro. Cualquiera
 * con acceso a la base podría editar una fila de `command_log`; esto lo detecta y dice exactamente
 * en qué maniobra se rompió.
 *
 * Va bajo `view_event_logs` —el permiso de la auditoría— y no bajo `system_config`: comprobar que el
 * histórico está íntegro es justo lo que necesita quien audita, y no debería exigir ser
 * administrador del sistema.
 *
 * La cadena es GLOBAL, no por planta: se encadena una única secuencia para todo el sistema, porque
 * cadenas separadas por planta permitirían borrar entera la de una planta sin que nada chirriara.
 */
@Controller('command-signatures')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CommandSignatureController {
  constructor(@Inject(CommandSignatureService) private readonly firmas: CommandSignatureService) {}

  @Get('verify')
  @RequirePermission('view_event_logs')
  async verify(): Promise<{
    verificable: boolean;
    firmadas: number;
    integra: boolean;
    rotos: EslabonRoto[];
    mensaje: string;
  }> {
    const { firmadas, rotos, verificable } = await this.firmas.verificar();
    return {
      verificable,
      firmadas,
      integra: verificable && rotos.length === 0,
      rotos,
      mensaje: !verificable
        ? 'No hay secreto de firma configurado: las maniobras no se están firmando.'
        : rotos.length === 0
          ? `Las ${firmadas} maniobras registradas conservan su firma original.`
          : `${rotos.length} de ${firmadas} maniobras no cuadran: el registro fue alterado después de firmarse.`,
    };
  }
}
