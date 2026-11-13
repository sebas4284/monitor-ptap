import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CommandSignatureService, type CommandVerification } from './command-signature.service';
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
    legado?: CommandVerification['legado'];
    desdeActivacion?: CommandVerification['desdeActivacion'];
  }> {
    const { firmadas, rotos, verificable, motivo, legado, desdeActivacion } = await this.firmas.verificar();
    return {
      verificable,
      firmadas,
      integra: verificable && rotos.length === 0 && !legado?.sinFirma,
      rotos,
      ...(legado ? { legado, desdeActivacion } : {}),
      mensaje: !verificable
        ? motivo === 'sin_secreto'
          ? 'No hay secreto de firma configurado: las maniobras no se están firmando.'
          : 'No se pudo verificar la evidencia del registro y su checkpoint externo. Se requiere revisión administrativa.'
        : rotos.length === 0 && legado
          ? `Frontera revisada conservada: ${legado.sinFirma} maniobras históricas siguen sin firma y su autenticidad no está demostrada. Las ${desdeActivacion?.firmadas ?? 0} maniobras firmadas desde la activación verifican contra el checkpoint externo.`
        : rotos.length === 0
          ? `Las ${firmadas} maniobras registradas conservan su firma original.`
          : `Se detectaron ${rotos.length} anomalías de firma o del checkpoint externo; el registro requiere revisión.`,
    };
  }
}
