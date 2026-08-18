import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { AppReleaseService, type AppRelease } from './app-release.service';

/**
 * Qué versión de la app está publicada para descargar.
 *
 * **`@Public()` a propósito.** Lo consulta la pantalla de login —antes de que exista sesión— para
 * ofrecer la descarga a quien entra por la web y todavía no tiene la app. Exigir token aquí
 * impediría justo el caso de uso, y no expone nada: es la misma información que ya sirve
 * `/descargar/` a cualquiera.
 */
@Controller('app')
export class AppReleaseController {
  constructor(private readonly releases: AppReleaseService) {}

  @Public()
  @Get('version')
  version(): AppRelease {
    return this.releases.get();
  }
}
