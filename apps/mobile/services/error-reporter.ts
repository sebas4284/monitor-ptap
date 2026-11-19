import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getAuthToken, postJson } from './api';

/**
 * Servicio soberano de diagnóstico y telemetría de errores (Clean-Room / In-House).
 *
 * Principios de diseño para infraestructura empresarial:
 * 1. CERO dependencias de servicios externos en la nube (reemplaza Sentry SaaS).
 * 2. CERO fuga de datos: los errores de la app se transmiten EXCLUSIVAMENTE a tu propio
 *    backend de Aquora mediante el endpoint seguro `/api/diagnostics/client-log`.
 * 3. Tolerante a fallos: una falla en el reporte NUNCA interrumpe la experiencia del operador.
 * 4. Deduplicación inteligente: no satura la red si un error se repite en bucle.
 */

interface ErrorPayload {
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
  plantId?: string;
  version?: string;
  at: string;
}

const MAX_BUFFER = 30;
const DEDUPE_WINDOW_MS = 10_000;

const buffer: ErrorPayload[] = [];
let lastReportedKey = '';
let lastReportedTime = 0;
let isFlushing = false;

const APP_VERSION =
  Constants.expoConfig?.version ??
  (Constants.manifest as { version?: string } | undefined)?.version ??
  '1.0.0';

/** Envía el buffer acumulado al propio backend cuando hay sesión disponible. */
async function flush(): Promise<void> {
  if (isFlushing || buffer.length === 0 || !getAuthToken()) return;
  isFlushing = true;

  try {
    while (buffer.length > 0) {
      const item = buffer[0];
      await postJson('/api/diagnostics/client-log', item);
      buffer.shift(); // Retira solo tras éxito comprobado
    }
  } catch {
    // Si la red no está disponible, el buffer se conserva hasta la próxima oportunidad.
  } finally {
    isFlushing = false;
  }
}

/**
 * Reporta un error o comportamiento anómalo al sistema de auditoría interno de Aquora.
 */
export function reportError(
  err: unknown,
  context?: Record<string, unknown>,
  plantId?: string,
): void {
  try {
    const errorMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : JSON.stringify(err);

    const stack = err instanceof Error ? err.stack : undefined;
    const now = Date.now();
    const dedupeKey = `${errorMsg}::${plantId ?? ''}`;

    // Deduplicación en ventana de 10 s para proteger el ancho de banda en plantas remotas
    if (dedupeKey === lastReportedKey && now - lastReportedTime < DEDUPE_WINDOW_MS) {
      return;
    }
    lastReportedKey = dedupeKey;
    lastReportedTime = now;

    const payload: ErrorPayload = {
      error: errorMsg,
      stack,
      context: {
        ...context,
        platform: Platform.OS,
      },
      plantId,
      version: APP_VERSION,
      at: new Date(now).toISOString(),
    };

    if (buffer.length >= MAX_BUFFER) {
      buffer.shift(); // Buffer circular: descarta el más antiguo
    }
    buffer.push(payload);

    // Intento asíncrono no bloqueante
    void flush();
  } catch {
    // Protección absoluta: el logger jamás debe ser causa de caída
  }
}

/**
 * Registra el manejador global de excepciones no controladas de JavaScript.
 * Llamar en `_layout.tsx` al inicio de la aplicación.
 */
export function initErrorReporter(): void {
  try {
    const defaultHandler =
      (ErrorUtils as { getGlobalHandler?: () => (e: Error, isFatal?: boolean) => void })
        .getGlobalHandler?.();

    (ErrorUtils as { setGlobalHandler: (fn: (e: Error, isFatal?: boolean) => void) => void })
      .setGlobalHandler((error: Error, isFatal?: boolean) => {
        reportError(error, { fatal: isFatal });
        if (defaultHandler) {
          defaultHandler(error, isFatal);
        }
      });
  } catch {
    // En entornos donde ErrorUtils no esté disponible (ej. web puro)
  }
}
