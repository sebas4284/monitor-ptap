import { z } from 'zod';
import { loadMapping } from '../../../infrastructure/connectivity/mapping/opc-mapping.loader';

/**
 * Registro público. `.strict()` es una decisión de SEGURIDAD, no de estilo: si el cliente
 * manda `role` (o cualquier campo NO declarado), la request se RECHAZA con 400 en vez de
 * ignorarlo en silencio. El rol lo fija el servidor siempre en 'civil' (AuthService.register)
 * — la matriz oficial reserva la asignación de roles al Administrador.
 *
 * Las validaciones de abajo son la primera barrera anti-basura/anti-bot (la segunda es la
 * verificación por correo, la tercera la aprobación del admin). Todas devuelven mensajes claros.
 */

/** Plantas REALES (slugs del mapping) — validar pertenencia, no solo formato. Cacheado. */
let knownPlantIds: Set<string> | null = null;
function isKnownPlant(slug: string): boolean {
  if (!knownPlantIds) {
    knownPlantIds = new Set(loadMapping().plants.map((p) => p.plantId));
  }
  return knownPlantIds.has(slug);
}

/**
 * Denylist corta de dominios de correo desechables (no exhaustiva — es un filtro, no un muro).
 * Se puede desactivar con REGISTER_BLOCK_DISPOSABLE=false. Ampliable sin tocar código si algún día
 * se externaliza a config.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'throwawaymail.com',
  'yopmail.com', 'getnada.com', 'trashmail.com', 'maildrop.cc', 'dispostable.com',
  'fakeinbox.com', 'mailnesia.com', 'mohmal.com', 'emailondeck.com',
]);
function isDisposableEmail(email: string): boolean {
  if (process.env.REGISTER_BLOCK_DISPOSABLE === 'false') return false;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

// El nombre no debe llevar URLs (los bots inyectan enlaces).
const URL_LIKE = /https?:\/\/|www\./i;
// ...ni caracteres de control (charCode < 32) — se comprueba sin regex para no escribir bytes crudos.
function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    if (v.charCodeAt(i) < 32) return true;
  }
  return false;
}

// Formato de teléfono: solo dígitos, +, -, paréntesis y espacios, con al menos 7 dígitos.
function isValidPhone(v: string): boolean {
  return /^[0-9+()\-\s]+$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7;
}

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'El nombre debe tener al menos 2 caracteres')
      .max(120)
      .refine((v) => !URL_LIKE.test(v), 'El nombre no puede contener enlaces')
      .refine((v) => !hasControlChars(v), 'El nombre contiene caracteres no válidos'),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Correo con formato inválido')
      .max(255)
      .refine((v) => !isDisposableEmail(v), 'No se permiten correos temporales/desechables'),
    // Vacío o ausente = sin teléfono. Cuando viene, se valida el formato.
    phone: z
      .string()
      .trim()
      .transform((v) => (v === '' ? undefined : v))
      .optional()
      .refine(
        (v) => v === undefined || isValidPhone(v),
        'Teléfono inválido (mínimo 7 dígitos; solo números, +, -, paréntesis y espacios)',
      ),
    plant: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_-]+$/, 'Planta con formato inválido')
      .refine(isKnownPlant, 'Planta desconocida'),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(200)
      .refine((v) => /[a-z]/.test(v), 'La contraseña debe incluir al menos una minúscula')
      .refine((v) => /[A-Z]/.test(v), 'La contraseña debe incluir al menos una mayúscula')
      .refine((v) => /\d/.test(v), 'La contraseña debe incluir al menos un dígito'),
    // Honeypot anti-bot: campo que un humano nunca ve ni llena. Si llega con contenido, es un bot.
    // Declarado (para que `.strict()` no lo rechace) pero DEBE ir vacío/ausente.
    website: z.string().max(0, 'Solicitud rechazada').optional(),
  })
  .strict();

export type RegisterDto = z.infer<typeof registerSchema>;
