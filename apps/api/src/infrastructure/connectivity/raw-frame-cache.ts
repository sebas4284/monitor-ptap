import type { RawBufferSample, RawPlantFrame } from './ports/connectivity-adapter.port';

interface PlantEntry {
  lastFrameAt: string | null;
  buffers: Map<string, RawBufferSample>; // browseName → última muestra
}

/**
 * Cache SOLO en RAM del último frame crudo por planta (regla 1: nada de telemetría a
 * disco). En Fase 1 alimenta /api/opc/status; en Fase 2 será la entrada del parser.
 */
export class RawFrameCache {
  private readonly plants = new Map<string, PlantEntry>();

  ingest(frame: RawPlantFrame): void {
    let entry = this.plants.get(frame.plantId);
    if (!entry) {
      entry = { lastFrameAt: null, buffers: new Map() };
      this.plants.set(frame.plantId, entry);
    }
    entry.lastFrameAt = frame.receivedAt;
    for (const buf of frame.buffers) entry.buffers.set(buf.browseName, buf);
  }

  lastFrameAt(plantId: string): string | null {
    return this.plants.get(plantId)?.lastFrameAt ?? null;
  }

  plantIds(): string[] {
    return [...this.plants.keys()];
  }

  getLastFrame(plantId: string): RawPlantFrame | null {
    const entry = this.plants.get(plantId);
    if (!entry) return null;

    return {
      plantId,
      buffers: [...entry.buffers.values()],
      receivedAt: entry.lastFrameAt ?? new Date().toISOString(),
    };
  }

  clear(): void {
    this.plants.clear();
  }
}
