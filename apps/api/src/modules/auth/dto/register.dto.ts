import { z } from 'zod';
import { plantIdParamSchema } from '../../../infrastructure/validation/plant-id.schema';

/**
 * Registro público. `.strict()` es una decisión de SEGURIDAD, no de estilo: si el cliente
 * manda `role` (o cualquier campo extra), la request se RECHAZA con 400 en vez de ignorarlo
 * en silencio. El rol lo fija el servidor siempre en 'civil' (AuthService.register) — la
 * matriz oficial reserva la asignación de roles al Administrador.
 */
export const registerSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(255),
    phone: z.string().min(5).max(32).optional(),
    plant: plantIdParamSchema,
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
  })
  .strict();

export type RegisterDto = z.infer<typeof registerSchema>;
