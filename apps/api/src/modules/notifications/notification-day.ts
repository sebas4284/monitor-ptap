import { diaLocal } from '../../infrastructure/connectivity/pipeline/dia-operativo';

/**
 * El «día» al que se ancla la deduplicación de avisos.
 *
 * **Local, no UTC**, y no es un detalle: era `now.toISOString().slice(0, 10)`, y con Colombia en
 * UTC−5 eso hace que la clave cambie a las **19:00 hora local**. Como todas las condiciones
 * persistentes cambian de clave en el mismo barrido, el operario recibía de golpe la ráfaga entera
 * del día —treinta y tantos avisos— a las siete de la tarde, con la planta vacía, y el móvil se los
 * colapsaba en un «37 avisos nuevos» sin severidad ni planta. Peor aún: un aviso creado a las 18:55
 * se repetía a las 19:05.
 *
 * La implementación vive en `dia-operativo.ts`, junto a la del tipo de día que usa el pipeline para
 * resolver los rangos operativos: son la misma decisión de zona horaria y no pueden divergir.
 */
export function dedupeDay(now: Date): string {
  return diaLocal(now);
}

export { esFinDeSemanaOFestivo, FESTIVOS } from '../../infrastructure/connectivity/pipeline/dia-operativo';
