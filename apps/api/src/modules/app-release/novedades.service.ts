import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNovedades, type Novedad } from './novedades.parser';

/**
 * Sirve el changelog de `docs/NOVEDADES.md` a la app.
 *
 * **No cachea, con la misma disciplina que `AppReleaseService`** y por el mismo motivo: el archivo
 * se actualiza en el despliegue y el proceso no siempre se reinicia después. Cachearlo dejaría a la
 * gente viendo el changelog de la versión anterior, que es justo el desfase que estas dos clases
 * existen para evitar. Es un archivo de 2 KB leído cuando alguien abre una pestaña: no hay nada que
 * optimizar.
 */

/** Permite apuntar a otro archivo en pruebas o en un despliegue con otra disposición. */
const ENV_VAR = 'NOVEDADES_FILE';
const RUTA_RELATIVA = join('docs', 'NOVEDADES.md');

/**
 * Dónde está el changelog. Se prueban varias rutas porque el proceso arranca desde sitios
 * distintos: pm2 lo corre con `cwd` en `apps/api` (y `__dirname` en `apps/api/dist/...`), mientras
 * los tests y `tsx` lo cargan desde la raíz del repo. Fijar una sola habría funcionado en local y
 * devuelto un listado vacío en producción, sin ningún síntoma.
 */
function candidatas(): string[] {
  return [
    join(process.cwd(), RUTA_RELATIVA),
    join(process.cwd(), '..', '..', RUTA_RELATIVA),
    // apps/api/{dist|src}/modules/app-release → cinco niveles hasta la raíz del repo.
    join(__dirname, '..', '..', '..', '..', '..', RUTA_RELATIVA),
  ];
}

@Injectable()
export class NovedadesService {
  private readonly logger = new Logger('Novedades');

  get(): Novedad[] {
    const archivo = this.archivo();
    if (!archivo) {
      // Un aviso, no una excepción: que falte el changelog no puede impedir abrir la bandeja.
      this.logger.warn(`no se encontró ${RUTA_RELATIVA}: la pestaña de novedades saldrá vacía`);
      return [];
    }
    try {
      return parseNovedades(readFileSync(archivo, 'utf8'));
    } catch (err) {
      this.logger.warn(`${archivo} ilegible: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  private archivo(): string | null {
    const explicito = process.env[ENV_VAR];
    if (explicito) return existsSync(explicito) ? explicito : null;
    return candidatas().find((c) => existsSync(c)) ?? null;
  }
}
