import { API_BASE_URL, getAuthToken } from './api';

/**
 * Probador de canales: escribir un valor en una posición del PLC, sostenerlo y soltarlo.
 *
 * Sirve para descubrir codificaciones de mando que el mapeo no conoce. Hoy 8 de las 10 plantas con
 * válvula llevan `open: 4096` heredado de La Vorágine y jamás verificado allí, y ninguna declara
 * `close`: la codificación real hay que capturarla, y capturarla implica escribir.
 *
 * **No sustituye al testigo humano.** En un sitio sin caudal, sin presión y sin palabra de estado
 * —Carbonero— el software no puede confirmar que la válvula se movió. Lo que puede hacer es escribir
 * de forma acotada, mirar qué más se movió y dejar constancia.
 */

export interface ProbeRequest {
  /** Canal de SALIDA: intOut, realOut, bitOut, msgWrite. */
  channel: string;
  /** browseName exacto del buffer. */
  sourceBuffer: string;
  index: number;
  value: number | boolean;
  /** Cuánto se sostiene, en ms. El servidor lo acota a 5 000. */
  holdMs: number;
}

export interface CambioObservado {
  browseName: string;
  index: number;
  de: number | boolean | null;
  a: number | boolean | null;
  /** Señal que lee ese índice, si alguna. Es lo que hace legible el hallazgo. */
  domainKey: string | null;
}

export interface ProbeResult {
  plantId: string;
  channel: string;
  sourceBuffer: string;
  index: number;
  requestedValue: number | boolean;
  holdMs: number;
  previousValue: number | boolean | null;
  writeEcho: number | boolean | null;
  writeVerified: boolean | null;
  /** ¿Se devolvió la salida a su valor anterior? **`false` exige atender la planta.** */
  released: boolean;
  releasedValue: number | boolean | null;
  observed: CambioObservado[];
  observedAfterRelease: CambioObservado[];
  /** ¿Llegó alguna muestra que mirar? `observed` vacío con esto en `false` no prueba nada. */
  sampled: boolean;
  valvesLocked: string[];
  status: 'done' | 'rejected' | 'failed';
  reason?: string;
  at: string;
}

/** Sostenidos que se ofrecen. Cortos primero: la prueba mínima que responde la pregunta. */
export const SOSTENIDOS_MS = [300, 1000, 3000, 5000] as const;

/**
 * Lanza la prueba y devuelve el resultado **también cuando el servidor responde 409 o 502**.
 *
 * No usa `postJson` a propósito: ese helper lanza en cualquier respuesta no-2xx y se queda solo con
 * el mensaje. Aquí el cuerpo es lo importante en los tres desenlaces — un `failed` con
 * `released: false` es justo el caso que hay que poder pintar entero en pantalla, y perderlo por un
 * `throw` sería lo contrario de lo que necesita quien está delante de la válvula.
 */
export async function probarCanal(plantId: string, req: ProbeRequest): Promise<ProbeResult> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE_URL}/api/plants/${plantId}/channel-probe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(req),
  });

  const cuerpo: unknown = await res.json().catch(() => null);
  if (cuerpo && typeof cuerpo === 'object' && 'status' in cuerpo) return cuerpo as ProbeResult;

  // Sin cuerpo estructurado no se puede afirmar nada sobre la salida, y callarlo sería peor que
  // decirlo: se devuelve un fallo explícito que la pantalla pinta como tal.
  const mensaje =
    cuerpo && typeof cuerpo === 'object' && 'message' in cuerpo
      ? String((cuerpo as { message: unknown }).message)
      : `El servidor respondió ${res.status} sin detalle.`;
  return {
    plantId,
    channel: req.channel,
    sourceBuffer: req.sourceBuffer,
    index: req.index,
    requestedValue: req.value,
    holdMs: req.holdMs,
    previousValue: null,
    writeEcho: null,
    writeVerified: null,
    // `released: false` a propósito: sin respuesta del servidor NO se puede afirmar que la salida
    // volviera a su sitio, y en esta pantalla afirmarlo de más es el error que no se puede cometer.
    released: false,
    releasedValue: null,
    observed: [],
    observedAfterRelease: [],
    sampled: false,
    valvesLocked: [],
    status: 'failed',
    reason: mensaje,
    at: new Date().toISOString(),
  };
}

/** `INT_OUT_CARBONERO[0] = 4096`, para el registro y para el resumen de pantalla. */
export function describeProbe(req: ProbeRequest): string {
  return `${req.sourceBuffer}[${req.index}] = ${String(req.value)}`;
}
