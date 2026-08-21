import { z } from 'zod';

/** `HH:MM` en 24 h. Se valida el formato para que la BD no acabe con un `TIME` inválido. */
const hora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM')
  .nullable();

/**
 * Preferencias de notificación que llegan del cliente.
 *
 * `mutedKinds` NO se valida contra la lista de tipos conocidos a propósito: un cliente viejo debe
 * poder guardar sus preferencias sin que un `kind` retirado le tumbe la petición entera, y un
 * cliente nuevo debe poder silenciar un tipo que este servidor todavía no conoce. Lo desconocido
 * simplemente no casa con nada al filtrar.
 */
export const notificationPrefsSchema = z
  .object({
    mutedKinds: z.array(z.string().min(1).max(64)).max(32).default([]),
    // Tope holgado pero real: son señales concretas de una planta, no una lista infinita. Sin
    // tope, un cliente con un bucle podría hacer crecer la fila sin control.
    mutedItems: z.array(z.string().min(1).max(128)).max(500).default([]),
    minSeverity: z.enum(['info', 'warning', 'critical']).default('info'),
    quietFrom: hora.default(null),
    quietTo: hora.default(null),
  })
  // O están las dos horas o no está ninguna: media franja no significa nada y guardarla dejaría un
  // "no molestar" que el cliente ignora en silencio.
  .refine((p) => (p.quietFrom === null) === (p.quietTo === null), {
    message: 'El horario de silencio necesita hora de inicio y de fin',
    path: ['quietTo'],
  });
