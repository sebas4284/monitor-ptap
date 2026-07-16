import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Role, UserSummary } from '@ptap/shared';
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

export interface NewUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  plant: string;
  passwordHash: string;
  pepperVersion: number;
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

interface SummaryRow extends RowDataPacket {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  plant: string;
  is_active: number;
  last_login_at: Date | null;
  created_at: Date | null;
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

function toSummary(row: SummaryRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? null,
    role: row.role as Role,
    plant: row.plant,
    isActive: row.is_active === 1,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

/** Código de MySQL para violación de índice único (email duplicado). */
export const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

/**
 * Acceso a la tabla `users` (mysql2 crudo, sin ORM). Nunca devuelve `passwordHash`/
 * `pepperVersion` fuera de esta capa hacia controllers — eso es responsabilidad de
 * `AuthService`, que es el único consumidor de esos campos. Lo que sale hacia la API es
 * `UserSummary` (sin secretos).
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

  /**
   * Inserta un usuario. El `role` lo decide SIEMPRE el servidor (AuthService fuerza 'civil'
   * en el registro público) — este método no debe recibirlo nunca desde el cliente.
   * Lanza el error de MySQL tal cual: el llamador traduce ER_DUP_ENTRY → 409.
   */
  async create(user: NewUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, email, phone, name, role, plant, password_hash, pepper_version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [user.id, user.email, user.phone, user.name, user.role, user.plant, user.passwordHash, user.pepperVersion],
    );
  }

  /** Listado para administración (sin secretos). Incluye inactivos. */
  async list(): Promise<UserSummary[]> {
    const [rows] = await this.pool.query<SummaryRow[]>(
      `SELECT id, email, phone, name, role, plant, is_active, last_login_at, created_at
         FROM users ORDER BY created_at DESC`,
    );
    return rows.map(toSummary);
  }

  /** Devuelve un usuario por id SIN filtrar por is_active (administración). */
  async findSummaryById(id: string): Promise<UserSummary | null> {
    const [rows] = await this.pool.query<SummaryRow[]>(
      `SELECT id, email, phone, name, role, plant, is_active, last_login_at, created_at
         FROM users WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows.length > 0 ? toSummary(rows[0]) : null;
  }

  async updateRole(id: string, role: Role): Promise<void> {
    await this.pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.pool.query('UPDATE users SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
  }
}
