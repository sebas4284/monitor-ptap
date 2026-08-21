import { Injectable } from '@nestjs/common';
import type { TankAutonomyDto } from '@ptap/shared';

/**
 * Autonomía vigente de cada tanque, para que el snapshot la publique.
 *
 * Es un buzón entre dos ritmos distintos: la calcula `TankAutonomyDetector` una vez por minuto —con
 * su temporizador, su banda muerta y el promedio de 24 h— y el pipeline construye snapshots cada
 * pocos segundos. Sin este buzón habría dos opciones, ambas peores: recalcularla en cada frame (y
 * perder la estabilidad que el cliente pidió expresamente, porque el número volvería a bailar) o
 * calcularla en el móvil (y tener dos implementaciones que pueden discrepar entre lo que dice la
 * tarjeta y lo que dice el aviso).
 *
 * Vive en `infrastructure` y no en el módulo de notificaciones porque quien lo LEE es el pipeline;
 * si estuviera al revés, la capa de datos dependería de la de avisos.
 *
 * Volátil a propósito, como el resto del pipeline: al reiniciar se vuelve a llenar en el primer
 * barrido. Hasta entonces el snapshot no trae autonomía, y la tarjeta no enseña un número viejo.
 */
@Injectable()
export class TankAutonomyStore {
  private readonly porPlanta = new Map<string, TankAutonomyDto[]>();

  set(plantId: string, autonomias: TankAutonomyDto[]): void {
    this.porPlanta.set(plantId, autonomias);
  }

  get(plantId: string): TankAutonomyDto[] {
    return this.porPlanta.get(plantId) ?? [];
  }
}
