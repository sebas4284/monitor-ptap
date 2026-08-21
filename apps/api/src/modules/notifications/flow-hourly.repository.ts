import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

/**
 * Promedio horario del caudal, para poder responder «¿cuánto aguantaría el tanque si cierro la
 * entrada ahora?» con el consumo típico del día y no con el caudal del instante.
 *
 * Guarda AGREGADOS, nunca muestras: una fila por planta y hora. Ver el comentario de la migración
 * `0011_create_flow_hourly.sql` para por qué eso no contradice la regla de no persistir telemetría.
 */
@Injectable()
export class FlowHourlyRepository {
  private readonly logger = new Logger('FlowHourly');

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  /**
   * Graba (o actualiza) el promedio de una hora concreta.
   *
   * `ON DUPLICATE KEY UPDATE` en vez de comprobar-y-luego-insertar: el detector puede reescribir la
   * hora en curso varias veces según acumula muestras, y dos barridos solapados no pueden crear dos
   * filas de la misma hora.
   */
  async upsert(plantId: string, domainKey: string, hourStart: Date, avgLps: number, samples: number): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO flow_hourly (plant_id, domain_key, hour_start, avg_lps, samples)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE avg_lps = VALUES(avg_lps), samples = VALUES(samples)`,
        [plantId, domainKey, hourStart, avgLps, samples],
      );
    } catch (err) {
      // Perder un promedio horario degrada la proyección, no el monitoreo. No puede tumbar nada.
      this.logger.warn(`no se pudo guardar el promedio horario de ${plantId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Promedio de las últimas `hours` horas, ponderado por número de muestras.
   *
   * Devuelve `null` si no hay NINGUNA hora registrada. Se devuelve también cuántas horas respaldan
   * el promedio para que quien lo use pueda decidir si se fía: promediar dos horas y llamarlo
   * "consumo del día" sería inventar.
   */
  async promedio(plantId: string, domainKey: string, hours: number): Promise<{ avgLps: number; horas: number } | null> {
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT SUM(avg_lps * samples) / NULLIF(SUM(samples), 0) AS avg_lps, COUNT(*) AS horas
           FROM flow_hourly
          WHERE plant_id = ? AND domain_key = ? AND hour_start >= NOW() - INTERVAL ? HOUR`,
        [plantId, domainKey, hours],
      );
      const r = rows[0];
      if (!r || r.avg_lps === null || Number(r.horas) === 0) return null;
      return { avgLps: Number(r.avg_lps), horas: Number(r.horas) };
    } catch (err) {
      this.logger.warn(`no se pudo leer el promedio de ${plantId}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Purga: el promedio de 24 h no necesita meses de historia. */
  async purgeOlderThan(days: number): Promise<number> {
    try {
      const [res] = await this.pool.query<RowDataPacket[] & { affectedRows?: number }>(
        'DELETE FROM flow_hourly WHERE hour_start < NOW() - INTERVAL ? DAY',
        [days],
      );
      return (res as { affectedRows?: number }).affectedRows ?? 0;
    } catch {
      return 0;
    }
  }
}
