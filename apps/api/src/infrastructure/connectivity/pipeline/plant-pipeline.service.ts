import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { CONNECTIVITY_ADAPTER, CONNECTIVITY_CONFIG } from '../connectivity.tokens';
import type { ConnectivityConfig } from '../connectivity.config';
import { loadMapping, type LoadedMapping } from '../mapping/opc-mapping.loader';
import type { ConnectivityAdapter, RawBufferSample, RawPlantFrame } from '../ports/connectivity-adapter.port';
import { DeadLetterBuffer } from './dead-letter.buffer';
import { LivenessTracker } from './liveness.tracker';
import { MappingEngine } from './mapping.engine';
import { PlantCache } from './plant-cache';
import type { LivenessChange, LivenessState, PlantSnapshotDto } from './plant-snapshot.dto';
import { buildSnapshot } from './snapshot.builder';

/**
 * PlantPipelineService: cierra la cadena en RAM
 *   RawPlantFrame (coalescido) → Parser/estado por planta → Liveness → Mapping Engine
 *     → QualityService → Snapshot Builder (DTO) → PlantCache → Socket.IO.
 *
 * Es el ÚNICO escritor de PlantCache (regla del contrato). Emite opc:snapshot solo cuando
 * el snapshot cambia (diff), y opc:liveness en cambios de estado. Un barrido periódico
 * re-evalúa el liveness para pasar idle→stale aunque no lleguen frames (un caudal congelado
 * NO debe verse conectado con un dato viejo).
 */
@Injectable()
export class PlantPipelineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PlantPipeline');
  private readonly mapping: LoadedMapping;
  private readonly engine: MappingEngine;
  private readonly liveness: LivenessTracker;
  private readonly deadLetter = new DeadLetterBuffer();

  // Estado ACUMULADO por planta: última muestra de cada buffer (para reconstruir el DTO
  // completo aunque el frame coalescido traiga solo los buffers que cambiaron).
  private readonly latestBuffers = new Map<string, Map<string, RawBufferSample>>();
  private readonly lastSignature = new Map<string, string>();
  private readonly lastLivenessState = new Map<string, LivenessState>();

  private sweepTimer: NodeJS.Timeout | null = null;

  readonly snapshot$ = new Subject<PlantSnapshotDto>();
  readonly liveness$ = new Subject<LivenessChange>();

  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(CONNECTIVITY_CONFIG) private readonly config: ConnectivityConfig,
    @Inject(PlantCache) private readonly cache: PlantCache,
  ) {
    this.mapping = loadMapping();
    this.engine = new MappingEngine(this.mapping);
    this.liveness = new LivenessTracker(config.liveness.liveSec, config.liveness.windowSec);
    for (const p of this.mapping.plants) this.liveness.configurePlant(p.plantId, p.livenessWindowSec);
  }

  onModuleInit(): void {
    this.adapter.onFrame((frame) => this.processFrame(frame));
    this.sweepTimer = setInterval(() => this.sweepLiveness(), this.config.liveness.sweepMs);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  getDeadLetter() {
    return this.deadLetter.snapshot();
  }

  /** Lista de plantas con su liveness actual (para GET /api/plants), incluso sin snapshot aún. */
  listPlants(): Array<{ plantId: string; displayName: string; liveness: ReturnType<LivenessTracker['get']>; bridgeStatus: string }> {
    const bridgeStatus = this.adapter.getBridgeStatus();
    return this.mapping.plants.map((p) => ({
      plantId: p.plantId,
      displayName: p.displayName,
      liveness: this.liveness.get(p.plantId),
      bridgeStatus,
    }));
  }

  private processFrame(frame: RawPlantFrame): void {
    const buffers = this.ensureBuffers(frame.plantId);
    for (const buf of frame.buffers) buffers.set(buf.browseName, buf);
    this.liveness.ingest(frame);
    this.rebuildAndMaybeEmit(frame.plantId);
  }

  /** Re-evalúa liveness de todas las plantas conocidas; emite si el estado cambió. */
  private sweepLiveness(): void {
    for (const p of this.mapping.plants) {
      const state = this.liveness.get(p.plantId).state;
      if (state !== this.lastLivenessState.get(p.plantId)) {
        this.rebuildAndMaybeEmit(p.plantId);
      }
    }
  }

  private rebuildAndMaybeEmit(plantId: string): void {
    const plant = this.mapping.plants.find((p) => p.plantId === plantId);
    if (!plant) return;
    const liveness = this.liveness.get(plantId);
    const extracted = this.engine.extract(plantId, this.ensureBuffers(plantId), this.deadLetter);
    const bridgeStatus = this.adapter.getBridgeStatus();

    const candidate = buildSnapshot({
      plantId,
      displayName: plant.displayName,
      protocolVersion: this.mapping.protocolVersion,
      dtoVersion: this.mapping.dtoVersion,
      sequence: 0, // provisional; se asigna al confirmar el diff
      bridgeStatus,
      liveness,
      extracted,
      deadLetter: this.deadLetter,
    });

    // Diff: firma sin sequence. No emitir snapshots idénticos (PASO 3.7).
    const signature = JSON.stringify({ signals: candidate.signals, liveness, bridgeStatus });
    const prevLivenessState = this.lastLivenessState.get(plantId);
    this.lastLivenessState.set(plantId, liveness.state);

    if (this.lastSignature.get(plantId) === signature) return;
    this.lastSignature.set(plantId, signature);

    const sequence = this.cache.nextSequence(plantId);
    const snapshot: PlantSnapshotDto = { ...candidate, sequence };
    this.cache.write(snapshot); // ÚNICO escritor
    this.snapshot$.next(snapshot);

    if (liveness.state !== prevLivenessState) {
      this.liveness$.next({ plantId, state: liveness.state, lastChangeAt: liveness.lastChangeAt, windowSec: liveness.windowSec });
    }
  }

  private ensureBuffers(plantId: string): Map<string, RawBufferSample> {
    let m = this.latestBuffers.get(plantId);
    if (!m) {
      m = new Map();
      this.latestBuffers.set(plantId, m);
    }
    return m;
  }
}
