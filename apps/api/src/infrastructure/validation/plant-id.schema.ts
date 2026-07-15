import { z } from 'zod';

/** plantId es siempre un slug canónico (regla del prompt maestro: "nada de 'PTAP Norte'"). */
export const plantIdParamSchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/);
