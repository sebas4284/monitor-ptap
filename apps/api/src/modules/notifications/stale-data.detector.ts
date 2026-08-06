import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { hasRangeAnomaly, isOutOfOperatingRange, type PlantSnapshotDto } from '@ptap/shared';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import { NotificationRepository, type NewNotification } from './notification.repository';

/**
 * Detector de problemas que merecen un aviso persistente.
 *
 * Nació de un hallazgo de campo (2026-08-05): **6 de 12 plantas llevaban entre 17 horas y 15 días
 * sin que su buffer OPC UA se refrescara**, y la aplicación las mostraba en azul como "proceso
 * quieto, todo normal". Nadie lo supo hasta que un operador comparó la pantalla con el HMI de la
 * planta y vio el caudal oscilando donde nosotros teníamos un número clavado.
 *
 * Dos detecciones:
 *
 *  1. **Sensor sin refrescar** (`sensor_stale`). Si el dato más fresco de una planta tiene más de
 *     `STALE_HOURS`, lo más probable es que el sensor o su enlace estén averiados.
 *  2. **Señal fuera de rango** (`signal_out_of_range`), con el MISMO predicado que usa el front
 *     (`hasRangeAnomaly` de `@ptap/shared`), para que la bandeja no contradiga al tablero.
 *
 * **La antigüedad se mide con el `SourceTimestamp` del PLC, no con el reloj interno del proceso.**
 * Es deliberado: `liveness.lastChangeAt` se reinicia con el backend, así que tras un reinicio una
 * planta congelada hace 15 días arrancaría sin historial y no se avisaría nunca. El
 * `SourceTimestamp` es absoluto y sobrevive a los reinicios.
 *
 * Cadencia: se revisa cada `SWEEP_MS`, pero el repositorio deduplica por día, así que un problema
 * que persiste genera **un aviso cada 24 h** — ni uno por ciclo, ni solo uno y nunca más.
 */
@Injectable()
export class StaleDataDetector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('StaleDataDetector');
  private timer: ReturnType<typeof setInterval> | null = null;

  /** A partir de aquí se considera que el sensor probablemente falla (decisión operativa). */
  private readonly staleHours = Number(process.env.NOTIFY_STALE_HOURS ?? 1);
  /** Cada cuánto se revisa. No define la frecuencia del aviso: eso lo fija la deduplicación diaria. */
  private readonly sweepMs = Number(process.env.NOTIFY_SWEEP_MS ?? 10 * 60_000);
  private readonly retentionDays = Number(process.env.NOTIFY_RETENTION_DAYS ?? 30);

  constructor(
    private readonly pipeline: PlantPipelineService,
    private readonly cache: PlantCache,
    private readonly repo: NotificationRepository,
  ) {}

  onModuleInit(): void {
    // Un barrido al arrancar: si el backend se reinicia con plantas ya congeladas, el aviso no
    // debe esperar al primer ciclo.
    setTimeout(() => void this.sweep(), 30_000).unref?.();
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref?.();
    this.logger.log(
      `detector activo: sensor sin refrescar > ${this.staleHours} h, barrido cada ${Math.round(this.sweepMs / 60000)} min`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Un ciclo completo. Público para poder ejercitarlo en tests sin esperar al temporizador. */
  async sweep(now = new Date()): Promise<number> {
    let created = 0;
    try {
      for (const plant of this.pipeline.listPlants()) {
        const snapshot = this.cache.get(plant.plantId);
        if (!snapshot || snapshot.pending) continue;
        for (const n of this.detect(plant.displayName, snapshot, now)) {
          if (await this.repo.create(n)) created++;
        }
      }
      if (created > 0) this.logger.warn(`${created} notificación(es) nueva(s)`);
      await this.repo.purgeOlderThan(this.retentionDays);
    } catch (err) {
      // Un fallo del detector no puede tumbar el backend ni la telemetría.
      this.logger.error(`barrido fallido: ${err instanceof Error ? err.message : err}`);
    }
    return created;
  }

  /**
   * Reglas puras: dado un snapshot, qué avisos corresponden. Sin base de datos, fácil de probar.
   *
   * La frescura se evalúa **por señal**, no por planta. Se descubrió desplegando: Soledad tenía
   * 9 sensores congelados hace días y una señal viva, así que a nivel de planta parecía fresca y
   * sus 9 valores clavados se reportaban como "fuera de rango". Era cierto pero engañoso — están
   * fuera de rango PORQUE llevan días sin actualizarse. La causa es el sensor, y eso es lo que hay
   * que decir.
   */
  detect(displayName: string, snapshot: PlantSnapshotDto, now: Date): NewNotification[] {
    const day = now.toISOString().slice(0, 10);
    const out: NewNotification[] = [];
    const base = { plantId: snapshot.plantId, day };

    const entries = Object.entries(snapshot.signals);
    const stale: { key: string; label: string; ageH: number }[] = [];
    const frescas: [string, (typeof entries)[number][1]][] = [];

    for (const [domainKey, signal] of entries) {
      const ageH = signalAgeHours(signal, now);
      if (ageH !== null && ageH >= this.staleHours) {
        stale.push({ key: domainKey, label: signal.label ?? domainKey, ageH });
      } else {
        frescas.push([domainKey, signal]);
      }
    }

    if (stale.length > 0) {
      const peor = Math.max(...stale.map((s) => s.ageH));
      const todas = frescas.length === 0;
      const quienes = todas
        ? 'Ninguna señal de esta planta se está actualizando'
        : `${stale.length} de ${entries.length} señales no se ${stale.length === 1 ? 'está' : 'están'} actualizando (${stale
            .slice(0, 4)
            .map((s) => s.label)
            .join(', ')}${stale.length > 4 ? '…' : ''})`;
      out.push({
        ...base,
        kind: 'sensor_stale',
        severity: 'critical',
        // Con una sola señal afectada se puede señalar el item exacto; con varias, la planta.
        subject: stale.length === 1 ? stale[0].key : null,
        title: todas
          ? `${displayName}: sensor sin refrescar`
          : `${displayName}: ${stale.length} sensor${stale.length === 1 ? '' : 'es'} sin refrescar`,
        message:
          `${quienes}. La lectura más vieja tiene ${humanAge(peor)}. El equipo responde, pero esos ` +
          `valores no cambian: lo más probable es que el sensor o su enlace de comunicación estén ` +
          `averiados. Lo que se ve en pantalla para esas señales no representa la situación actual.`,
      });
    }

    // Solo se juzga el rango de lo que SÍ está fresco: alarmar por un valor que ya sabemos viejo
    // es ruido, y además apunta a la causa equivocada.
    for (const [domainKey, signal] of frescas) {
      if (!hasRangeAnomaly(signal)) continue;
      const label = signal.label ?? domainKey;
      const critical = Boolean(signal.outOfRange);
      const limite = isOutOfOperatingRange(signal)
        ? typeof signal.opMin === 'number' && (signal.value as number) < signal.opMin
          ? `por debajo del mínimo operativo (${signal.opMin}${signal.unit ? ' ' + signal.unit : ''})`
          : `por encima del máximo operativo (${signal.opMax}${signal.unit ? ' ' + signal.unit : ''})`
        : 'fuera del rango físico válido';
      out.push({
        ...base,
        kind: 'signal_out_of_range',
        severity: critical ? 'critical' : 'warning',
        subject: domainKey,
        title: `${displayName}: ${label} fuera de rango`,
        message: `${label} marca ${signal.value}${signal.unit ? ' ' + signal.unit : ''}, ${limite}.`,
      });
    }
    return out;
  }
}

/**
 * Antigüedad de UNA señal, en horas. `null` si no trae `SourceTimestamp`: sin evidencia de cuándo
 * se leyó, no se puede afirmar que esté vieja (y afirmarlo sería justo el tipo de mentira que este
 * detector existe para evitar).
 */
function signalAgeHours(signal: { ts: string | null }, now: Date): number | null {
  if (!signal.ts) return null;
  const t = Date.parse(signal.ts);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

function humanAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutos`;
  if (hours < 48) return `${Math.round(hours)} horas`;
  return `${Math.floor(hours / 24)} días`;
}
