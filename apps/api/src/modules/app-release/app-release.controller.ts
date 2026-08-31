import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { AppReleaseService, type AppRelease } from './app-release.service';
import { NovedadesService } from './novedades.service';
import type { Novedad } from './novedades.parser';

/**
 * Qué versión de la app está publicada para descargar, y qué cambió en cada una.
 *
 * **`@Public()` a propósito.** Lo consulta la pantalla de login —antes de que exista sesión— para
 * ofrecer la descarga a quien entra por la web y todavía no tiene la app. Exigir token aquí
 * impediría justo el caso de uso, y no expone nada: es la misma información que ya sirve
 * `/descargar/` a cualquiera.
 */
@Controller('app')
export class AppReleaseController {
  constructor(
    private readonly releases: AppReleaseService,
    private readonly novedadesSvc: NovedadesService,
  ) {}

  @Public()
  @Get('version')
  version(): AppRelease {
    return this.releases.get();
  }

  /**
   * El changelog que ve el usuario, de la versión más reciente a la más antigua.
   *
   * `@Public()` con el mismo criterio que `version`: el banner de la pantalla de login enseña las
   * notas de la versión publicada, y ahí todavía no hay sesión.
   */
  @Public()
  @Get('novedades')
  novedades(): { novedades: Novedad[] } {
    return { novedades: this.novedadesSvc.get() };
  }
}
