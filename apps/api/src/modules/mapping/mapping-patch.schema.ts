import { z } from 'zod';

/**
 * Forma del cuerpo de `PATCH /api/opc/mapping/:plantId/:domainKey`.
 *
 * `.strict()` a propósito: un campo que no esté aquí **se rechaza** en vez de ignorarse. Es el
 * mismo criterio que `additionalProperties: false` del schema del mapeo, y evita el peor final
 * posible — que alguien mande `indice` en vez de `index`, reciba un 200 y crea que corrigió algo.
 *
 * `null` es distinto de ausente: ausente significa «no lo toques» y `null`, «déjalo sin valor».
 * Quitar un rango operativo mal puesto es una corrección legítima y tiene que poder expresarse.
 * `index` no admite `null`: toda señal cuelga de una posición concreta de un buffer.
 */
export const mappingPatchSchema = z
  .object({
    index: z.number().int().min(0).max(10_000).optional(),
    sourceBuffer: z.string().min(1).max(120).nullable().optional(),
    unit: z.string().min(1).max(16).nullable().optional(),
    min: z.number().finite().nullable().optional(),
    max: z.number().finite().nullable().optional(),
    opMin: z.number().finite().nullable().optional(),
    opMax: z.number().finite().nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'No se mandó ningún campo que cambiar.' });

/** Mismo patrón que exige el schema del mapeo para `domainKey`. */
export const domainKeyParamSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/);

export type MappingPatchBody = z.infer<typeof mappingPatchSchema>;
