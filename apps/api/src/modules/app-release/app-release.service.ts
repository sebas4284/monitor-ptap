import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Qué versión de la APK está PUBLICADA para descargar.
 *
 * **La fuente de verdad es el archivo publicado, no el repositorio.** Esa distinción es el corazón
 * de este servicio: durante semanas el repo fue por delante de lo que la gente tenía instalado
 * (2026-08-15: la APK servida era del 11-ago, dos commits de `apps/mobile/` por detrás) y nadie se
 * enteraba porque nada comparaba una cosa con la otra. Leer la versión de `app.json` habría
 * heredado exactamente ese engaño: diría "1.1.0" mientras se sirve un archivo que es 1.0.0.
 *
 * Por eso se lee `version.json`, que lo escribe el script de compilación JUNTO al `.apk`. Si ese
 * archivo falta o no cuadra con el APK, se dice que no se sabe — nunca se adivina una versión.
 */

export interface AppRelease {
  /** Versión publicada (semver), o null si no se pudo determinar. */
  version: string | null;
  /** `versionCode` de Android: es el que DECIDE si una instalación es más vieja. */
  versionCode: number | null;
  /** Cuándo se compiló el APK que hoy se sirve (mtime real del archivo). */
  publishedAt: string | null;
  /** Tamaño en bytes, para que la app pueda avisar antes de una descarga grande. */
  sizeBytes: number | null;
  /** A dónde mandar al usuario para actualizar. */
  downloadUrl: string;
  /** Qué cambió, para no pedirle a nadie que actualice a ciegas. */
  notes: string | null;
}

const APK_FILE = 'monitor-ptap.apk';
const META_FILE = 'version.json';

/**
 * Dónde `apk-publicar.sh` deja el APK y su metadato.
 *
 * Se resuelve en CADA llamada, no en una constante de módulo: fijarlo al importar lo volvía
 * imposible de probar y contradecía el principio de este servicio, que es no cachear nada porque
 * publicar una APK no reinicia el backend.
 */
function downloadDir(): string {
  return process.env.APK_PUBLISH_DIR ?? '/var/www/ptap-download';
}

@Injectable()
export class AppReleaseService {
  private readonly logger = new Logger('AppRelease');

  /**
   * Lee el estado publicado en cada petición, a propósito: publicar una APK nueva NO reinicia el
   * backend, así que cachearlo dejaría a los usuarios viendo la versión anterior hasta el próximo
   * despliegue — el mismo tipo de desfase que este servicio existe para evitar.
   */
  get(): AppRelease {
    const base: AppRelease = {
      version: null,
      versionCode: null,
      publishedAt: null,
      sizeBytes: null,
      downloadUrl: this.downloadUrl(),
      notes: null,
    };

    const apk = join(downloadDir(), APK_FILE);
    if (!existsSync(apk)) return base;

    try {
      const st = statSync(apk);
      base.publishedAt = st.mtime.toISOString();
      base.sizeBytes = st.size;
    } catch {
      /* el tamaño y la fecha son adorno: su ausencia no invalida la versión */
    }

    try {
      const meta = join(downloadDir(), META_FILE);
      if (existsSync(meta)) {
        const raw = JSON.parse(readFileSync(meta, 'utf8')) as Record<string, unknown>;
        if (typeof raw.version === 'string') base.version = raw.version;
        if (typeof raw.versionCode === 'number') base.versionCode = raw.versionCode;
        if (typeof raw.notes === 'string') base.notes = raw.notes;
      } else {
        // Sin metadato no se inventa: la app mostrará el enlace de descarga sin afirmar que hay
        // una versión nueva, que es lo honesto.
        this.logger.warn(`hay APK publicada pero falta ${META_FILE}: no se puede saber su versión`);
      }
    } catch (err) {
      this.logger.warn(`${META_FILE} ilegible: ${err instanceof Error ? err.message : err}`);
    }

    return base;
  }

  private downloadUrl(): string {
    const base = (process.env.APP_PUBLIC_URL ?? '').replace(/\/+$/, '');
    return `${base}/descargar/`;
  }
}
