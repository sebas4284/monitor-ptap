import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  plant: string;
  passwordHash: string;
  pepperVersion: number;
  isActive: boolean;
}

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  name: string;
  role: string;
  plant: string;
  password_hash: string;
  pepper_version: number;
  is_active: number;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    plant: row.plant,
    passwordHash: row.password_hash,
    pepperVersion: row.pepper_version,
    isActive: row.is_active === 1,
  };
}

/**
 * Acceso a la tabla `users` (mysql2 crudo, sin ORM). Nunca devuelve `passwordHash`/
 * `pepperVersion` fuera de esta capa hacia controllers — eso es responsabilidad de
 * `AuthService`, que es el único consumidor de esos campos.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const [rows] = await this.pool.query<UserRow[]>(
      'SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email],
    );
    return rows.length > 0 ? toRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [rows] = await this.pool.query<UserRow[]>(
      'SELECT * FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [id],
    );
    return rows.length > 0 ? toRecord(rows[0]) : null;
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [id]);
  }
}
