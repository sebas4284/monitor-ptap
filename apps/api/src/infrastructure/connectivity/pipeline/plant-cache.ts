import { Injectable } from '@nestjs/common';
import type { PlantSnapshotDto } from './plant-snapshot.dto';

/**
 * PlantCache (RAM, regla 1): ÚNICO propietario de los snapshots de dominio. Solo el
 * PlantPipelineService escribe (write); REST/Socket.IO/frontend solo leen. Nunca se
 * persiste a disco. También custodia el contador `sequence` monótono por planta.
 */
@Injectable()
export class PlantCache {
  private readonly snapshots = new Map<string, PlantSnapshotDto>();
  private readonly sequences = new Map<string, number>();

  /** Siguiente sequence para una planta (monótono, +1 por snapshot emitido). */
  nextSequence(plantId: string): number {
    const next = (this.sequences.get(plantId) ?? 0) + 1;
    this.sequences.set(plantId, next);
    return next;
  }

  write(snapshot: PlantSnapshotDto): void {
    this.snapshots.set(snapshot.plantId, snapshot);
  }

  get(plantId: string): PlantSnapshotDto | null {
    return this.snapshots.get(plantId) ?? null;
  }

  list(): PlantSnapshotDto[] {
    return [...this.snapshots.values()];
  }
}
