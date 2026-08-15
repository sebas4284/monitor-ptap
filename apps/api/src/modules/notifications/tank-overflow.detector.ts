import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import { NotificationRepository, type NewNotification } from './notification.repository';
import { analyzeTanks, type TankSample } from './tank-overflow.analyzer';

/**
 * Vigila los tanques que pasan de su máximo y avisa DICIENDO CUÁL DE LOS DOS CASOS ES
 * (ver `tank-overflow.analyzer.ts` para el razonamiento físico).
 *
 * Aquí vive lo único que el analizador no puede saber por sí solo: **la historia**. Para
 * distinguir "sigue subiendo" de "se estancó" hace falta comparar con la lectura anterior, y para
 * proponer un máximo corregido hace falta recordar el nivel más alto que se ha visto de verdad.
 *
 * El barrido comparte cadencia con `StaleDataDetector` (10 min por defecto) y el repositorio
 * deduplica por día, así que un tanque que lleva una semana por encima de su máximo genera un
 * aviso diario, no uno por ciclo.
 */
@Injectable()
export class TankOverflowDetector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TankLevel');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sweepMs = Number(process.env.NOTIFY_SWEEP_MS ?? 10 * 60_000);

  /** plantId → (tank<N> → última muestra). Para el veredicto sube/se mantiene. */
  private readonly historial = new Map<string, Map<string, TankSample>>();
  /**
   * plantId → (tank<N> → nivel más alto observado). Es la evidencia dura para proponer un máximo
   * corregido: no se inventa una altura, se dice "el tanque llegó a estar aquí".
   */
  private readonly maxObservado = new Map<string, Map<string, number>>();

  constructor(
    private readonly pipeline: PlantPipelineService,
    private readonly cache: PlantCache,
    private readonly repo: NotificationRepository,
  ) {}

  onModuleInit(): void {
    // Un poco después que el detector de frescura, para no encimar dos barridos en el arranque.
    setTimeout(() => void this.sweep(), 45_000).unref?.();
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref?.();
    this.logger.log(`vigilancia de tanques activa: barrido cada ${Math.round(this.sweepMs / 60000)} min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Un ciclo completo. Público para ejercitarlo en tests sin esperar al temporizador. */
  async sweep(now = new Date()): Promise<number> {
    let created = 0;
    try {
      for (const plant of this.pipeline.listPlants()) {
        const snapshot = this.cache.get(plant.plantId);
        if (!snapshot || snapshot.pending) continue;

        const hist = this.ensure(this.historial, plant.plantId);
        const maxObs = this.ensure(this.maxObservado, plant.plantId);
        const findings = analyzeTanks(snapshot, plant.displayName, hist, maxObs, now);

        for (const f of findings) {
          const n: NewNotification = {
            kind: 'tank_level',
            // Crítico solo lo que está pasando AHORA y perjudica al servicio:
            //  - `rebosando`: se está perdiendo agua tratada por el rebosadero.
            //  - `bajo_minimo_cayendo`: el nivel no alcanza para llevar agua a las casas y va a peor.
            // Lo demás es un dato nuestro que corregir (`maximo_mal`) o una situación que ya se
            // está recuperando sola: importa, pero no saca a nadie de la cama.
            severity:
              f.verdict === 'rebosando' || f.verdict === 'bajo_minimo_cayendo' ? 'critical' : 'warning',
            plantId: snapshot.plantId,
            subject: `tank${f.tankN}`,
            title: f.title,
            message: f.message,
            day: now.toISOString().slice(0, 10),
          };
          if (await this.repo.create(n)) created++;
        }

        // La historia se actualiza SIEMPRE, con findings o sin ellos: el nivel de hoy es el
        // "anterior" del próximo barrido, y el máximo observado sirve aunque nunca pase del tope.
        this.recordLevels(snapshot.signals, hist, maxObs, now.getTime());
      }
      if (created > 0) this.logger.warn(`${created} aviso(s) de nivel de tanque fuera de la franja de operación`);
    } catch (err) {
      // Un fallo aquí no puede tumbar el backend ni la telemetría.
      this.logger.error(`barrido de tanques fallido: ${err instanceof Error ? err.message : err}`);
    }
    return created;
  }

  private recordLevels(
    signals: Record<string, { value: number | boolean | null }>,
    hist: Map<string, TankSample>,
    maxObs: Map<string, number>,
    atMs: number,
  ): void {
    for (const [key, sig] of Object.entries(signals)) {
      const m = /^tank(\d+)Level$/.exec(key);
      if (!m || typeof sig.value !== 'number' || !Number.isFinite(sig.value)) continue;
      const k = `tank${m[1]}`;
      hist.set(k, { levelM: sig.value, atMs });
      maxObs.set(k, Math.max(maxObs.get(k) ?? Number.NEGATIVE_INFINITY, sig.value));
    }
  }

  private ensure<V>(mapa: Map<string, Map<string, V>>, plantId: string): Map<string, V> {
    let m = mapa.get(plantId);
    if (!m) {
      m = new Map<string, V>();
      mapa.set(plantId, m);
    }
    return m;
  }
}
