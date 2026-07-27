import { z } from 'zod';

/**
 * `metric` es un domainKey del mapping (p. ej. `inletFlow1`, `outletPressure1`): alfanumérico
 * con `_`/`-`. La regex PROHÍBE `/`, `.` y `..`, cerrando el path traversal en la descarga de CSV
 * (`join(dir, plantId, `${metric}.csv`)`). La whitelist real por planta la valida el servicio.
 */
export const metricParamSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Métrica con formato inválido');
