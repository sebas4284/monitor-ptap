import { z } from 'zod';

// `.strict()` rechaza campos extra; los topes de longitud evitan payloads abusivos (un
// password sin límite es un vector de DoS al hashear). El email se normaliza igual que en registro.
export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Correo con formato inválido').max(255),
    password: z.string().min(1).max(200),
  })
  .strict();

export type LoginDto = z.infer<typeof loginSchema>;
