import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import { loadMapping } from '../../infrastructure/connectivity/mapping/opc-mapping.loader';

/**
 * Motor de INFORMES por métrica. Un informe = recolección de UNA señal de UNA planta, muestreada
 * cada `REPORT_SAMPLE_INTERVAL_MS` (default 1 min) durante `REPORT_SAMPLE_COUNT` muestras
 * (default 60 → 1 hora). El resultado es un CSV en disco (Fecha | Hora | Cantidad), UNO por
 * (planta, métrica): el siguiente lo REEMPLAZA (no hay historial). NO pasa por la base de datos
 * (regla 1: la telemetría no se persiste en MySQL; esto es un archivo de exportación).
 *
 * Reglas de concurrencia (del requerimiento): no se puede lanzar otra recolección del MISMO
 * informe mientras uno está en curso (409); informes de métricas DISTINTAS sí corren a la vez.
 *
 * Automático: cada informe se regenera cada `REPORTS_AUTO_INTERVAL_MS` (default 7 días) tras su
 * última generación; el ciclo se persiste en `index.json` para sobrevivir reinicios. La primera
 * generación la dispara el admin (o, si se define `REPORTS_AUTO_PLANT`, se siembra al arrancar
 * para las métricas de esa planta).
 */

export interface ReportMetric {
  metric: string;
  label: string;
  unit: string | null;
}
export type ReportStatus = 'idle' | 'collecting' | 'ready';
export interface ReportInfo extends ReportMetric {
  status: ReportStatus;
  /** Muestras tomadas / total mientras `collecting`; null en otro caso. */
  progress: number | null;
  total: number | null;
  /** ISO de la última recolección COMPLETADA (archivo listo), o null. */
  generatedAt: string | null;
  rows: number | null;
  /** ISO de la próxima regeneración automática, o null. */
  nextAutoAt: string | null;
}

interface Sample {
  at: Date;
  value: number | null;
}
interface Job {
  samples: Sample[];
  total: number;
  timer: ReturnType<typeof setInterval>;
  startedAt: Date;
}
interface IndexEntry {
  generatedAt: string;
  rows: number;
  nextAutoAt: string;
}

function intEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
function two(n: number): string {
  return String(n).padStart(2, '0');
}

@Injectable()
export class ReportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ReportsService');
  private readonly dir = process.env.REPORTS_DIR || join(process.cwd(), 'reports');
  private readonly sampleIntervalMs = intEnv('REPORT_SAMPLE_INTERVAL_MS', 60_000);
  private readonly sampleCount = intEnv('REPORT_SAMPLE_COUNT', 60);
  private readonly autoIntervalMs = intEnv('REPORTS_AUTO_INTERVAL_MS', 7 * 24 * 60 * 60 * 1000);

  /** Recolecciones en curso, por `${plantId}::${metric}`. Su presencia ES el lock. */
  private readonly jobs = new Map<string, Job>();
  /** Temporizadores del ciclo automático, por clave. */
  private readonly autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Estado persistido (última generación + próxima auto), por clave. */
  private index: Record<string, IndexEntry> = {};

  constructor(@Inject(PlantCache) private readonly cache: PlantCache) {}

  onModuleInit(): void {
    mkdirSync(this.dir, { recursive: true });
    this.index = this.loadIndex();
    // Re-armar el ciclo automático de los informes ya generados.
    for (const [key, entry] of Object.entries(this.index)) {
      this.scheduleAuto(key, new Date(entry.nextAutoAt).getTime() - Date.now());
    }
    // Sembrar el automático de una planta (opcional): arranca sus métricas aún sin archivo.
    const seedPlant = process.env.REPORTS_AUTO_PLANT;
    if (seedPlant) {
      for (const m of this.metricsFor(seedPlant)) {
        const key = this.key(seedPlant, m.metric);
        if (!this.index[key] && !this.jobs.has(key)) {
          try {
            this.startCollection(seedPlant, m.metric);
          } catch (err) {
            this.logger.warn(`no se pudo sembrar ${key}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }
  }

  onModuleDestroy(): void {
    for (const job of this.jobs.values()) clearInterval(job.timer);
    for (const timer of this.autoTimers.values()) clearTimeout(timer);
    this.jobs.clear();
    this.autoTimers.clear();
  }

  // ── API pública (la usa el controller) ──────────────────────────────────────

  /** Métricas disponibles de una planta con su estado de informe. */
  list(plantId: string): ReportInfo[] {
    return this.metricsFor(plantId).map((m) => {
      const key = this.key(plantId, m.metric);
      const job = this.jobs.get(key);
      const entry = this.index[key];
      const status: ReportStatus = job ? 'collecting' : entry ? 'ready' : 'idle';
      return {
        ...m,
        status,
        progress: job ? job.samples.length : null,
        total: job ? job.total : null,
        generatedAt: entry?.generatedAt ?? null,
        rows: entry?.rows ?? null,
        nextAutoAt: entry?.nextAutoAt ?? null,
      };
    });
  }

  /** Lanza una recolección manual. 404 si la métrica no existe; 409 si ya hay una en curso. */
  generate(plantId: string, metric: string): void {
    if (!this.metricsFor(plantId).some((m) => m.metric === metric)) {
      throw new NotFoundException(`Métrica desconocida para la planta: ${metric}`);
    }
    if (this.jobs.has(this.key(plantId, metric))) {
      throw new ConflictException('Ya hay una recolección de este informe en curso. Espera a que termine.');
    }
    this.startCollection(plantId, metric);
  }

  /** Ruta del CSV listo, o null si no hay. El controller lo transmite. */
  filePath(plantId: string, metric: string): string | null {
    const path = this.csvPath(plantId, metric);
    return existsSync(path) ? path : null;
  }

  fileName(plantId: string, metric: string): string {
    const gen = this.index[this.key(plantId, metric)]?.generatedAt ?? new Date().toISOString();
    const stamp = gen.slice(0, 19).replace(/[:T]/g, '-');
    return `informe-${plantId}-${metric}-${stamp}.csv`;
  }

  // ── Recolección ─────────────────────────────────────────────────────────────

  private startCollection(plantId: string, metric: string): void {
    const key = this.key(plantId, metric);
    const job: Job = { samples: [], total: this.sampleCount, timer: null as never, startedAt: new Date() };

    const takeSample = () => {
      const snap = this.cache.get(plantId);
      const raw = snap?.signals?.[metric]?.value;
      job.samples.push({ at: new Date(), value: typeof raw === 'number' ? raw : null });
      if (job.samples.length >= job.total) {
        clearInterval(job.timer);
        this.jobs.delete(key);
        this.finish(plantId, metric, job.samples);
      }
    };

    this.jobs.set(key, job);
    takeSample(); // primera muestra en t=0
    if (job.samples.length < job.total) {
      job.timer = setInterval(takeSample, this.sampleIntervalMs);
      job.timer.unref?.();
    }
    this.logger.log(`informe ${key}: recolectando ${job.total} muestras cada ${this.sampleIntervalMs} ms`);
  }

  private finish(plantId: string, metric: string, samples: Sample[]): void {
    const meta = this.metricsFor(plantId).find((m) => m.metric === metric);
    const csv = this.buildCsv(meta?.label ?? metric, meta?.unit ?? null, samples);
    const path = this.csvPath(plantId, metric);
    mkdirSync(join(this.dir, plantId), { recursive: true });
    writeFileSync(path, csv, 'utf8'); // REEMPLAZA el anterior (no hay historial)

    const now = Date.now();
    const key = this.key(plantId, metric);
    this.index[key] = {
      generatedAt: new Date(now).toISOString(),
      rows: samples.length,
      nextAutoAt: new Date(now + this.autoIntervalMs).toISOString(),
    };
    this.saveIndex();
    this.scheduleAuto(key, this.autoIntervalMs);
    this.logger.log(`informe ${key}: listo (${samples.length} filas) → ${path}`);
  }

  /** CSV con BOM + `sep=,` (para que Excel lo abra en celdas en cualquier idioma). */
  private buildCsv(label: string, unit: string | null, samples: Sample[]): string {
    const header = `Fecha,Hora,Cantidad${unit ? ` (${unit})` : ''}`;
    const lines = samples.map((s) => {
      const d = s.at;
      const fecha = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
      const hora = `${two(d.getHours())}:${two(d.getMinutes())}`;
      const cantidad = s.value === null ? '' : s.value.toFixed(2);
      return `${fecha},${hora},${cantidad}`;
    });
    return `﻿sep=,\n${header}\n${lines.join('\n')}\n`;
  }

  private scheduleAuto(key: string, delayMs: number): void {
    const existing = this.autoTimers.get(key);
    if (existing) clearTimeout(existing);
    const [plantId, metric] = key.split('::');
    const timer = setTimeout(() => {
      this.autoTimers.delete(key);
      if (!this.jobs.has(key)) this.startCollection(plantId, metric);
    }, Math.max(0, delayMs));
    timer.unref?.();
    this.autoTimers.set(key, timer);
  }

  // ── Utilidades ──────────────────────────────────────────────────────────────

  private metricsFor(plantId: string): ReportMetric[] {
    return loadMapping()
      .signals.filter((s) => s.plantId === plantId)
      .map((s) => ({ metric: s.domainKey, label: s.label ?? s.domainKey, unit: s.unit }));
  }

  private key(plantId: string, metric: string): string {
    return `${plantId}::${metric}`;
  }
  private csvPath(plantId: string, metric: string): string {
    return join(this.dir, plantId, `${metric}.csv`);
  }
  private indexPath(): string {
    return join(this.dir, 'index.json');
  }
  private loadIndex(): Record<string, IndexEntry> {
    try {
      return existsSync(this.indexPath()) ? (JSON.parse(readFileSync(this.indexPath(), 'utf8')) as Record<string, IndexEntry>) : {};
    } catch {
      return {};
    }
  }
  private saveIndex(): void {
    try {
      writeFileSync(this.indexPath(), JSON.stringify(this.index, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn(`no se pudo guardar el index de informes: ${err instanceof Error ? err.message : err}`);
    }
  }
}
