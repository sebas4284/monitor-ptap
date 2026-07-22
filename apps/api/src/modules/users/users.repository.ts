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
  emailVerified: boolean;
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

/** Criterios de búsqueda del panel de administración. Todos opcionales y combinables (AND). */
export interface UserListFilter {
  /** Coincidencia parcial contra nombre, correo o teléfono. */
  search?: string;
  role?: Role;
  isActive?: boolean;
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
  email_verified: number;
}

interface SummaryRow extends RowDataPacket {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  plant: string;
  is_active: number;
  email_verified: number;
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
    emailVerified: row.email_verified === 1,
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
    emailVerified: row.email_verified === 1,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

/**
 * Neutraliza los comodines de LIKE (`%`, `_`) y el propio escape (`\`) para que la búsqueda sea
 * literal. Parametrizar (?) evita la inyección SQL, pero no evita que un `%` escrito por el
 * usuario haga de comodín y devuelva de más.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
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

  /**
   * Devuelve el usuario AUNQUE esté inactivo: `isActive` viaja en el registro y lo decide
   * AuthService. Así el login puede distinguir "cuenta pendiente de aprobación" de
   * "credenciales inválidas" — pero solo DESPUÉS de verificar la contraseña, para no
   * revelar qué correos existen (enumeración de cuentas).
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const [rows] = await this.pool.query<UserRow[]>('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    return rows.length > 0 ? toRecord(rows[0]) : null;
  }

  /**
   * Usuario VIGENTE por id: filtra `is_active = 1` a propósito. Lo llama `JwtAuthGuard` en cada
   * petición autenticada, así que este filtro es lo que hace que desactivar una cuenta expulse
   * a esa sesión en el acto en vez de esperar a que caduque su token. Devolver un inactivo aquí
   * reabriría ese hueco.
   */
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
   * Inserta un usuario del auto-registro. Dos cosas las decide SIEMPRE el servidor, nunca el
   * cliente: el `role` (AuthService fuerza 'civil') y `is_active = 0` — la cuenta nace pendiente
   * de que un administrador la apruebe. La siembra de usuarios de demo no pasa por aquí
   * (scripts/seed-users.ts inserta ya aprobados).
   * Lanza el error de MySQL tal cual: el llamador traduce ER_DUP_ENTRY → 409.
   */
  async create(user: NewUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, email, phone, name, role, plant, password_hash, pepper_version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [user.id, user.email, user.phone, user.name, user.role, user.plant, user.passwordHash, user.pepperVersion],
    );
  }

  /**
   * Listado para administración (sin secretos). Incluye inactivos.
   *
   * El filtrado ocurre AQUÍ, no en el cliente: la lista crece con el tiempo y mandar todos los
   * usuarios al navegador para descartarlos allí publicaría correos y teléfonos que el filtro
   * pretendía dejar fuera. Todo va parametrizado (?) — `search` viaja como valor, jamás
   * concatenado, así que un `%` o una comilla en la búsqueda es texto, no SQL.
   */
  async list(filter: UserListFilter = {}): Promise<UserSummary[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.search) {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      const like = `%${escapeLike(filter.search)}%`;
      params.push(like, like, like);
    }
    if (filter.role) {
      where.push('role = ?');
      params.push(filter.role);
    }
    if (filter.isActive !== undefined) {
      where.push('is_active = ?');
      params.push(filter.isActive ? 1 : 0);
    }

    const [rows] = await this.pool.query<SummaryRow[]>(
      `SELECT id, email, phone, name, role, plant, is_active, email_verified, last_login_at, created_at
         FROM users
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC`,
      params,
    );
    return rows.map(toSummary);
  }

  /** Devuelve un usuario por id SIN filtrar por is_active (administración). */
  async findSummaryById(id: string): Promise<UserSummary | null> {
    const [rows] = await this.pool.query<SummaryRow[]>(
      `SELECT id, email, phone, name, role, plant, is_active, email_verified, last_login_at, created_at
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

  /** Marca el correo del usuario como verificado (lo llama AuthService.verifyEmail). */
  async setEmailVerified(id: string): Promise<void> {
    await this.pool.query('UPDATE users SET email_verified = 1 WHERE id = ?', [id]);
  }
}
