import { z } from 'zod';
import type { CommandValue } from './command-log.repository';

/** Cuerpo de POST /api/plants/:plantId/commands. API de DOMINIO, nunca de NodeIds. */
export const commandRequestSchema = z
  .object({
    command: z.string().min(1).max(64),
    target: z.string().min(1).max(64),
    idempotencyKey: z.string().min(1).max(120).optional(),
  })
  .strict();

export type CommandRequest = z.infer<typeof commandRequestSchema>;

/**
 * `sent` es un desenlace intermedio deliberado, no un "casi confirmado": la escritura salió y el
 * eco la verificó en el canal, pero el canal de ESTADO de ese sitio no tiene semántica verificada
 * en campo (`readBack.stateVerified: false`), así que el sistema **no puede afirmar ni negar** que
 * el equipo se movió. Reportarlo como `failed` acusaría al equipo con base en un valor inferido;
 * reportarlo como `confirmed` afirmaría un movimiento que nadie observó. Ninguna de las dos es
 * cierta, y por eso existe este tercer estado.
 */
export type CommandOutcome = 'confirmed' | 'sent' | 'failed' | 'rejected';

/** Motivos de rechazo (comando NO ejecutado) y de fallo (ejecutado, sin confirmar). */
export const REJECT = {
  TARGET_NOT_WRITABLE: 'TARGET_NOT_WRITABLE',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  WRITES_DISABLED_INSECURE_SESSION: 'WRITES_DISABLED_INSECURE_SESSION',
  FORBIDDEN: 'FORBIDDEN',
  INTERLOCK_FAILED: 'INTERLOCK_FAILED',
  IN_PROGRESS: 'IN_PROGRESS',
} as const;

export const FAIL = {
  /** Se escribió (write aceptado) pero el canal de ESTADO no confirmó dentro del timeout. */
  READBACK_UNCONFIRMED: 'READBACK_UNCONFIRMED',
  /**
   * La ESCRITURA MISMA falló: el servidor OPC UA la rechazó (StatusCode != Good), no había sesión,
   * el buffer estaba faulted o se cayó la red. Antes esto se reportaba como READBACK_UNCONFIRMED,
   * lo que hacía imposible distinguir "no pude escribir" de "escribí y el equipo no respondió"
   * (hallazgo de campo 2026-07-30).
   */
  WRITE_REJECTED: 'WRITE_REJECTED',
  /**
   * La señal se sostuvo hasta el tope y la REALIMENTACIÓN nunca llegó (`pulse.until`): el final de
   * carrera no avisó de que la válvula terminara su recorrido. El bit se soltó igualmente.
   *
   * Es un motivo aparte de READBACK_UNCONFIRMED por lo que significa cada uno: aquí el equipo no
   * dijo "he llegado", allí dijo algo que no cuadra con lo esperado. Un final de carrera averiado y
   * una palabra de estado mal interpretada son averías distintas, y un solo motivo para las dos
   * borra justo el dato que sirve para distinguirlas.
   */
  HOLD_FEEDBACK_TIMEOUT: 'HOLD_FEEDBACK_TIMEOUT',
  /**
   * Realimentación por bits (`pulse.feedback`): durante el sostenido el PLC informó FALLA de la
   * válvula. La orden se soltó. No es lo mismo que un tope agotado: aquí el equipo SÍ respondió, y
   * lo que dijo es que no puede moverse (en La Vorágine, el temporizador de falla de 90 s del PLC, o
   * una falla anterior que hay que rearmar desde la HMI).
   */
  VALVE_FAULT: 'VALVE_FAULT',
  /**
   * El sostenido se cortó porque llegó la orden CONTRARIA sobre la misma válvula (cerrar mientras se
   * sostenía abrir). Se soltó sin confirmación: ni el equipo falló ni se agotó el tope.
   */
  HOLD_REPLACED: 'HOLD_REPLACED',
  /**
   * El proceso se detuvo (reinicio, despliegue, caída) con el sostenido en marcha. El bit lo apagó el
   * apagado ordenado o la limpieza de huérfanos al volver a conectar el puente; qué hizo la válvula
   * no se sabe.
   */
  HOLD_INTERRUPTED: 'HOLD_INTERRUPTED',
} as const;

/** Motivos de desenlace `sent`: se escribió y se verificó, pero no hay con qué confirmar el estado. */
export const SENT = {
  /**
   * El eco confirma que el valor quedó en el canal de comando, pero el canal de ESTADO de este
   * sitio está declarado `stateVerified: false` — su valor esperado es una inferencia, no una
   * captura. No se afirma que el equipo se movió, ni se lo acusa de no haberlo hecho.
   */
  SENT_STATE_UNVERIFIED: 'SENT_STATE_UNVERIFIED',
  /**
   * Realimentación por bits (`pulse.feedback`, integrador 2026-10-23): la orden salió y se mantiene en
   * SEGUNDO PLANO hasta que el PLC confirme o informe falla (máx. `holdMs`). La respuesta HTTP no
   * espera: el resultado final queda en `command_log` (fila de resultado), en la auditoría y en la
   * bandeja, y la app lo ve en el estado en vivo de la válvula.
   *
   * Mientras el sostenido sigue, la fila de la orden conserva este motivo; es lo que permite saber,
   * tras un reinicio, qué órdenes se quedaron sin resultado (ver `FAIL.HOLD_INTERRUPTED`).
   */
  SENT_HOLDING_UNTIL_FEEDBACK: 'SENT_HOLDING_UNTIL_FEEDBACK',
} as const;

/** Resultado del sostenido con realimentación: lo que va al aviso, a la auditoría y a `command_log`. */
export const RESULTADO_DEL_SOSTENIDO = {
  /** El PLC informó el estado del verbo (abierta con abrir, cerrada con cerrar). */
  FEEDBACK_CONFIRMED: 'FEEDBACK_CONFIRMED',
} as const;

export interface CommandResult {
  status: CommandOutcome;
  reason: string | null;
  plantId: string;
  target: string;
  command: string;
  previousValue: CommandValue;
  writtenValue: CommandValue;
  confirmedValue: CommandValue;
  /**
   * ECO del canal de COMANDO leído INMEDIATAMENTE después de escribir (el mismo elemento que se
   * escribió). Responde "¿se escribió en ese instante?" de forma independiente del canal de estado.
   * null = no se pudo leer el eco.
   */
  writeEcho: CommandValue;
  /** true si el eco coincide con el valor escrito → la escritura SÍ llegó al canal. */
  writeVerified: boolean | null;
  /** sequence del snapshot usado para el interlock (trazabilidad). */
  interlockSequence: number | null;
  /** true si es una respuesta idempotente (comando ya ejecutado con la misma idempotencyKey). */
  idempotent: boolean;
  at: string;
}

/** Actor autenticado que emite el comando (de request.user + IP). */
export interface CommandActor {
  userId: string | null;
  /**
   * Nombre de la persona, congelado en la maniobra.
   *
   * Se arrastra hasta el registro firmado a propósito: el aviso que verán los demás operarios y el
   * jefe de planta tiene que decir «Ana Ruiz abrió la válvula de entrada», no un identificador de
   * cuenta. Y tiene que seguir diciéndolo si mañana esa cuenta se renombra o se da de baja.
   */
  userName: string | null;
  userEmail: string | null;
  role: string | null;
  ip: string | null;
}

/**
 * Código HTTP para un resultado de comando. confirmado→200; fallido (ejecutado sin confirmar
 * read-back)→502 (nunca 2xx: regla "sin read-back confirmado → fallido"); rechazos→4xx.
 */
export function httpStatusForCommand(result: CommandResult): number {
  if (result.status === 'confirmed') return 200;
  // 202 Accepted: la orden se ejecutó y quedó verificada en el canal, pero su efecto sobre el
  // equipo no es comprobable con la información disponible. Ni 200 (afirmaría el movimiento) ni
  // 502 (culparía al equipo).
  if (result.status === 'sent') return 202;
  if (result.status === 'failed') return 502;
  const reason = result.reason ?? '';
  if (reason === REJECT.FORBIDDEN || reason === REJECT.WRITES_DISABLED_INSECURE_SESSION) return 403;
  if (reason === REJECT.UNKNOWN_COMMAND) return 400;
  if (reason.startsWith(REJECT.INTERLOCK_FAILED) || reason === REJECT.IN_PROGRESS) return 409;
  if (reason === REJECT.TARGET_NOT_WRITABLE) return 404;
  return 400;
}
