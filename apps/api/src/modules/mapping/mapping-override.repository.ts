import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';
import type { MappingOverride, MappingPatch } from '../../infrastructure/connectivity/mapping/mapping-overrides';

/**
 * Las correcciones del mapeo, en la base. Tabla `mapping_override` (migración 0014).
 *
 * **Append-only.** No hay UPDATE ni DELETE en este archivo, y no es un olvido: el override que rige
 * es la ÚLTIMA fila de cada (planta, señal), y revertir inserta una fila de reversión. Así queda el
 * rastro de quién reapuntó qué y cuándo, que es la pregunta que hay que poder contestar tres días
 * después cuando una planta empieza a leer raro.
 */

export interface EntradaOverride {
  plantId: string;
  domainKey: string;
  patch: MappingPatch;
  previous: MappingPatch;
  reverted: boolean;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  createdAt: string;
}

/** Las columnas JSON llegan ya parseadas o como texto según versión de MySQL. Se aceptan las dos. */
function parseJson(valor: unknown): MappingPatch {
  if (valor && typeof valor === 'object') return valor as MappingPatch;
  if (typeof valor === 'string') {
    try {
      const v: unknown = JSON.parse(valor);
      return v && typeof v === 'object' ? (v as MappingPatch) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function iso(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString();
  return typeof valor === 'string' ? valor : '';
}

function fila(r: RowDataPacket): EntradaOverride {
  return {
    plantId: String(r.plant_id),
    domainKey: String(r.domain_key),
    patch: parseJson(r.patch),
    previous: parseJson(r.previous),
    reverted: Number(r.reverted) === 1,
    userId: r.user_id ? String(r.user_id) : null,
    userEmail: r.user_email ? String(r.user_email) : null,
    userName: r.user_name ? String(r.user_name) : null,
    createdAt: iso(r.created_at),
  };
}

@Injectable()
export class MappingOverrideRepository {
  private readonly logger = new Logger('MappingOverride');

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  /**
   * Lo que rige ahora mismo, listo para empujar al pipeline.
   *
   * La subconsulta saca el id más alto por (planta, señal) y el JOIN trae esa fila; las reversiones
   * se descartan después, porque una reversión ES la última palabra sobre esa señal y significa
   * «ninguna corrección». Hacerlo al revés —filtrar `reverted = 0` dentro del MAX— resucitaría el
   * override anterior a la reversión, que es justo lo contrario de lo que pidió quien revirtió.
   */
  async listarEfectivos(): Promise<MappingOverride[]> {
    const entradas = await this.listarUltimas();
    return entradas
      .filter((e) => !e.reverted)
      .map((e) => ({
        plantId: e.plantId,
        domainKey: e.domainKey,
        patch: e.patch,
        by: e.userName ?? e.userEmail,
        at: e.createdAt,
      }));
  }

  /** Igual que el anterior pero con la fila completa (incluidas reversiones), para la pantalla. */
  async listarUltimas(): Promise<EntradaOverride[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT o.plant_id, o.domain_key, o.patch, o.previous, o.reverted,
              o.user_id, o.user_email, o.user_name, o.created_at
         FROM mapping_override o
         JOIN (SELECT plant_id, domain_key, MAX(id) AS id
                 FROM mapping_override
                GROUP BY plant_id, domain_key) u ON u.id = o.id
        ORDER BY o.plant_id, o.domain_key`,
    );
    return rows.map(fila);
  }

  /** La historia de una señal, de lo más reciente a lo más antiguo. */
  async historial(plantId: string, domainKey: string, limite = 20): Promise<EntradaOverride[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT plant_id, domain_key, patch, previous, reverted,
              user_id, user_email, user_name, created_at
         FROM mapping_override
        WHERE plant_id = ? AND domain_key = ?
        ORDER BY id DESC
        LIMIT ?`,
      [plantId, domainKey, Math.min(Math.max(limite, 1), 100)],
    );
    return rows.map(fila);
  }

  /** Registra un cambio. Devuelve el id insertado. Nunca actualiza ni borra nada. */
  async registrar(entrada: {
    plantId: string;
    domainKey: string;
    patch: MappingPatch;
    previous: MappingPatch;
    reverted: boolean;
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO mapping_override
         (plant_id, domain_key, patch, previous, reverted, user_id, user_email, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entrada.plantId,
        entrada.domainKey,
        JSON.stringify(entrada.patch),
        JSON.stringify(entrada.previous),
        entrada.reverted ? 1 : 0,
        entrada.userId,
        entrada.userEmail,
        entrada.userName,
      ],
    );
    this.logger.log(
      `${entrada.reverted ? 'reversión' : 'corrección'} de ${entrada.plantId}.${entrada.domainKey} por ${entrada.userEmail ?? 'desconocido'}: ${JSON.stringify(entrada.patch)}`,
    );
  }
}
