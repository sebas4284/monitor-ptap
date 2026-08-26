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
import { TankAutonomyStore } from './tank-autonomy.store';

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
  private readonly deadLetter: DeadLetterBuffer;

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
    @Inject(TankAutonomyStore) private readonly autonomia: TankAutonomyStore,
  ) {
    this.deadLetter = new DeadLetterBuffer(config.deadLetterCapacity);
    this.mapping = loadMapping();
    this.engine = new MappingEngine(this.mapping);
    this.liveness = new LivenessTracker(config.liveness.liveSec, config.liveness.windowSec);
    for (const p of this.mapping.plants) this.liveness.configurePlant(p.plantId, p.livenessWindowSec);
  }

  onModuleInit(): void {
    this.adapter.onFrame((frame) => this.processFrame(frame));

    /**
     * Un cambio de estado del puente TIENE que reconstruir los snapshots.
     *
     * `bridgeStatus` viaja DENTRO del DTO de cada planta y es lo único con lo que el front
     * clasifica el corte (`classifyBridge` → banner y código del catálogo). Pero el snapshot
     * solo se reconstruía al llegar un frame o al CAMBIAR el estado de liveness, y cuando el
     * PLC deja de ser alcanzable no ocurre ninguna de las dos: no llegan frames, y la liveness
     * ya está en `frozen` y se queda ahí, así que el guard del barrido nunca se cumple.
     *
     * Resultado en producción el 2026-08-25: el puente pasó de `Stale` a Recovering → Faulted
     * → Disconnected → Connecting en cinco segundos, y el DTO se quedó congelado en `Stale`
     * indefinidamente. La app mostraba PLC-02, "la conexión con la planta está activa, pero el
     * equipo dejó de enviar lecturas", mientras el servidor no alcanzaba SIQUIERA el puerto del
     * PLC (EHOSTUNREACH). El mensaje más tranquilizador de todos, en el peor momento posible.
     *
     * La firma del diff ya incluye `bridgeStatus`, así que reconstruir aquí sí emite; y si el
     * estado vuelve a uno ya visto sin nada más que cambie, el diff lo suprime igual.
     */
    this.adapter.onStatusChange(() => {
      for (const p of this.mapping.plants) this.rebuildAndMaybeEmit(p.plantId);
    });

    this.sweepTimer = setInterval(() => this.sweepLiveness(), this.config.liveness.sweepMs);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Últimas muestras crudas de una planta, para el modo desarrollador (solo lectura).
   *
   * Devuelve la MISMA referencia que usa el pipeline, no una copia: el consumidor es un endpoint de
   * diagnóstico que serializa y descarta. Copiar 50 flotantes por buffer y 6 buffers por planta en
   * cada consulta sería trabajo tirado. Quien la reciba no debe mutarla.
   */
  getLatestBuffers(plantId: string): Map<string, RawBufferSample> | undefined {
    return this.latestBuffers.get(plantId);
  }

  /** El mapping cargado, para que el diagnóstico pueda cruzar índices con señales. */
  getMapping(): LoadedMapping {
    return this.mapping;
  }

  getDeadLetter() {
    return this.deadLetter.snapshot();
  }

  /** Lista de plantas con su liveness actual (para GET /api/plants), incluso sin snapshot aún. */
  listPlants(): Array<{ plantId: string; displayName: string; liveness: ReturnType<LivenessTracker['get']>; bridgeStatus: string }> {
    const bridgeStatus = this.adapter.getBridgeStatus();
    const healthy = bridgeStatus === 'Connected';
    return this.mapping.plants.map((p) => ({
      plantId: p.plantId,
      displayName: p.displayName,
      liveness: this.liveness.get(p.plantId, healthy),
      bridgeStatus,
    }));
  }

  private processFrame(frame: RawPlantFrame): void {
    const buffers = this.ensureBuffers(frame.plantId);
    for (const buf of frame.buffers) buffers.set(buf.browseName, buf);
    this.liveness.ingest(frame);
    this.rebuildAndMaybeEmit(frame.plantId);
  }

  /**
   * ¿La sesión con el PLC está viva? Solo `Connected` lo garantiza: en `Connecting`/`Recovering`
   * el puente aún no tiene (o perdió) la suscripción, y en `Stale`/`Disconnected`/`Faulted`
   * directamente no hay fuente. Es lo que distingue una planta quieta (stable) de una planta
   * que dejamos de ver (frozen).
   */
  private isSourceHealthy(): boolean {
    return this.adapter.getBridgeStatus() === 'Connected';
  }

  /** Re-evalúa liveness de todas las plantas conocidas; emite si el estado cambió. */
  private sweepLiveness(): void {
    const healthy = this.isSourceHealthy();
    for (const p of this.mapping.plants) {
      const state = this.liveness.get(p.plantId, healthy).state;
      if (state !== this.lastLivenessState.get(p.plantId)) {
        this.rebuildAndMaybeEmit(p.plantId);
      }
    }
  }

  private rebuildAndMaybeEmit(plantId: string): void {
    const plant = this.mapping.plants.find((p) => p.plantId === plantId);
    if (!plant) return;
    const bridgeStatus = this.adapter.getBridgeStatus();
    const liveness = this.liveness.get(plantId, bridgeStatus === 'Connected');
    const extracted = this.engine.extract(plantId, this.ensureBuffers(plantId), this.deadLetter);

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
    // La autonomía la calcula el detector una vez por minuto, con su temporizador estable; aquí
    // solo se adjunta. Recalcularla en cada frame devolvería el baile que el cliente pidió evitar.
    const autonomy = this.autonomia.get(plantId);
    if (autonomy.length > 0) candidate.autonomy = autonomy;

    // Diff: firma sin sequence. No emitir snapshots idénticos (PASO 3.7). Firma BARATA (sin
    // JSON.stringify de todo el objeto en CADA frame): solo los campos que cambian en runtime
    // distinguen un snapshot — value/quality/usable/reason/ts por señal + liveness + bridge. Los
    // estáticos del mapping (unit/label/mappingStatus/confidence/opMin/opMax/stateEncoding) no cambian sin
    // reiniciar, así que omitirlos NO altera la decisión de diff, y se ahorra CPU en el hot path.
    let signature = `${bridgeStatus}|${liveness.state}|${liveness.lastChangeAt ?? ''}|${liveness.windowSec ?? ''}`;
    for (const key of Object.keys(candidate.signals)) {
      const sig = candidate.signals[key];
      signature += `|${key}=${String(sig.value)}:${sig.quality}:${sig.usable ? 1 : 0}:${sig.reason ?? ''}:${sig.ts ?? ''}`;
    }
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
