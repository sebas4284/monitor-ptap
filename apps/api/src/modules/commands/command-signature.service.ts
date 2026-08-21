import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';
import {
  firmaCorta,
  sellar,
  verificarCadena,
  type CommandFacts,
  type EslabonRoto,
} from './command-signature';

/**
 * Sella cada maniobra de válvula y permite verificar el histórico completo.
 *
 * El problema que resuelve: en estas plantas **no hay confirmación eléctrica** de que una válvula se
 * abriera. El PLC no lo dice y el estado se deduce del caudal. Si el equipo no puede dar fe, la
 * única evidencia posible es el registro de quién dio la orden — y un registro que se pueda
 * retocar después no es evidencia de nada.
 *
 * Por eso la cadena: cada fila sella también el sello de la anterior. Modificar una maniobra,
 * borrarla o colar una inventada rompe la cadena a partir de ahí, y `verificar()` señala el punto
 * exacto.
 *
 * **Nunca lanza al camino del comando.** Si el sellado falla, la maniobra ya ocurrió: se registra el
 * fallo y se sigue. Un error del libro de firmas no puede convertirse en una orden a medias.
 */
@Injectable()
export class CommandSignatureService {
  private readonly logger = new Logger('CommandSignature');
  private readonly secreto: string;

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {
    // Secreto propio si existe; si no, el del token. No se inventa uno aleatorio al arrancar: un
    // secreto que cambia en cada reinicio invalidaría todas las firmas anteriores en silencio, que
    // es peor que no firmar — parecería que alguien manipuló el histórico.
    const propio = process.env.COMMAND_SIGNING_SECRET?.trim();
    const jwt = process.env.JWT_SECRET?.trim();
    this.secreto = propio || jwt || '';
    if (!propio && jwt) {
      this.logger.warn('COMMAND_SIGNING_SECRET no está definido: se firma con JWT_SECRET. Rotar el token invalidaría las firmas.');
    }
    if (!this.secreto) {
      this.logger.error('Sin secreto de firma: las maniobras quedarán SIN FIRMAR y el histórico no será verificable.');
    }
  }

  /**
   * Sella la fila de `command_log` recién finalizada y devuelve la firma corta que verá la gente.
   *
   * Todo dentro de una transacción con `FOR UPDATE` sobre la última fila firmada: dos maniobras
   * simultáneas en plantas distintas no pueden encadenar sobre el mismo eslabón y bifurcar la
   * cadena. Es un cuello de botella de una fila, y con unas pocas maniobras al día no molesta.
   */
  async firmar(commandLogId: number, userName: string | null): Promise<string | null> {
    if (!this.secreto) return null;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      if (userName !== null) {
        await conn.query('UPDATE command_log SET user_name = ? WHERE id = ?', [userName, commandLogId]);
      }

      const [ultimas] = await conn.query<RowDataPacket[]>(
        'SELECT signature FROM command_log WHERE signature IS NOT NULL ORDER BY id DESC LIMIT 1 FOR UPDATE',
      );
      const previo = (ultimas[0]?.signature as string | undefined) ?? null;

      const [filas] = await conn.query<RowDataPacket[]>(
        `SELECT id, at, plant_id, target, command, status, user_id, user_name, user_email, role,
                written_value, confirmed_value
           FROM command_log WHERE id = ? FOR UPDATE`,
        [commandLogId],
      );
      const fila = filas[0];
      if (!fila) {
        await conn.rollback();
        return null;
      }

      const firma = sellar(aHechos(fila), previo, this.secreto);
      await conn.query('UPDATE command_log SET signature = ?, prev_signature = ?, signed_at = NOW(3) WHERE id = ?', [
        firma,
        previo,
        commandLogId,
      ]);
      await conn.commit();
      return firmaCorta(firma);
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        /* la conexión ya puede estar rota */
      }
      this.logger.error(`no se pudo firmar la maniobra ${commandLogId}: ${err instanceof Error ? err.message : err}`);
      return null;
    } finally {
      conn.release();
    }
  }

  /** Recorre toda la cadena. Devuelve cuántas maniobras hay firmadas y qué eslabones no cuadran. */
  async verificar(): Promise<{ firmadas: number; rotos: EslabonRoto[]; verificable: boolean }> {
    if (!this.secreto) return { firmadas: 0, rotos: [], verificable: false };
    const [filas] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, at, plant_id, target, command, status, user_id, user_name, user_email, role,
              written_value, confirmed_value, signature, prev_signature
         FROM command_log WHERE signature IS NOT NULL ORDER BY id ASC`,
    );
    const rotos = verificarCadena(
      filas.map((f) => ({
        ...aHechos(f),
        signature: f.signature as string,
        prevSignature: (f.prev_signature as string | null) ?? null,
      })),
      this.secreto,
    );
    return { firmadas: filas.length, rotos, verificable: true };
  }
}

/**
 * Convierte una fila de MySQL en los hechos que se firman.
 *
 * `at` se normaliza a ISO **siempre**: el driver devuelve `Date` o string según la configuración de
 * la conexión, y si el formato cambiara, las firmas viejas dejarían de verificar sin que nadie
 * hubiera tocado un solo dato.
 */
function aHechos(f: RowDataPacket): CommandFacts {
  const at = f.at as Date | string;
  return {
    id: f.id as number,
    at: at instanceof Date ? at.toISOString() : new Date(at).toISOString(),
    plantId: f.plant_id as string,
    target: f.target as string,
    command: f.command as string,
    status: f.status as string,
    userId: (f.user_id as string | null) ?? null,
    userName: (f.user_name as string | null) ?? null,
    userEmail: (f.user_email as string | null) ?? null,
    role: (f.role as string | null) ?? null,
    writtenValue: (f.written_value as string | null) ?? null,
    confirmedValue: (f.confirmed_value as string | null) ?? null,
  };
}
