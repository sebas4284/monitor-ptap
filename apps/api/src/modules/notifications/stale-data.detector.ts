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

  /** Reglas puras: dado un snapshot, qué avisos corresponden. Sin base de datos, fácil de probar. */
  detect(displayName: string, snapshot: PlantSnapshotDto, now: Date): NewNotification[] {
    const day = now.toISOString().slice(0, 10);
    const out: NewNotification[] = [];
    const base = { plantId: snapshot.plantId, day };

    const ageH = dataAgeHours(snapshot, now);
    if (ageH !== null && ageH >= this.staleHours) {
      out.push({
        ...base,
        kind: 'sensor_stale',
        severity: 'critical',
        subject: null,
        title: `${displayName}: sensor sin refrescar`,
        message:
          `La última lectura de esta planta tiene ${humanAge(ageH)}. El equipo sigue respondiendo, ` +
          `pero sus valores no cambian: lo más probable es que el sensor o su enlace de comunicación ` +
          `estén averiados. Los números en pantalla son de hace ${humanAge(ageH)} — no representan ` +
          `la situación actual de la planta.`,
      });
      // Con el dato congelado, avisar además de que está "fuera de rango" sería ruido sobre un
      // valor que ya sabemos viejo. Un solo aviso, el que explica la causa.
      return out;
    }

    for (const [domainKey, signal] of Object.entries(snapshot.signals)) {
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

/** Antigüedad del dato más fresco de la planta, en horas. `null` si ninguna señal trae timestamp. */
function dataAgeHours(snapshot: PlantSnapshotDto, now: Date): number | null {
  let newest = 0;
  for (const signal of Object.values(snapshot.signals)) {
    if (!signal.ts) continue;
    const t = Date.parse(signal.ts);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (newest === 0) return null;
  return (now.getTime() - newest) / 3_600_000;
}

function humanAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutos`;
  if (hours < 48) return `${Math.round(hours)} horas`;
  return `${Math.floor(hours / 24)} días`;
}
