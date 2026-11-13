import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';
import { recibeAvisosDe } from './device-push-token.repository';
import type { WebPushIdentity, WebPushSubscription } from './web-push.dto';

export interface OwnedWebPushSubscription extends WebPushSubscription { userId: string }
const hash = (endpoint: string): string => createHash('sha256').update(endpoint).digest('hex');
const mapRow = (r: RowDataPacket): OwnedWebPushSubscription => ({
  endpoint: String(r.endpoint), binding: String(r.binding), userId: String(r.user_id),
  keys: { p256dh: String(r.p256dh), auth: String(r.auth) },
});

@Injectable()
export class WebPushRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async register(userId: string, subscription: WebPushSubscription): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Lock the account so simultaneous registrations cannot exceed the account quota.
      const [users] = await connection.query<RowDataPacket[]>('SELECT role, plant FROM users WHERE id = ? AND is_active = 1 FOR UPDATE', [userId]);
      const user = users[0];
      if (!user || !recibeAvisosDe(String(user.role), user.plant as string | null, String(user.plant ?? ''))) {
        throw new ForbiddenException('Cuenta sin ámbito de notificaciones');
      }
      const [count] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM web_push_subscription WHERE user_id = ? AND endpoint_hash <> ?', [userId, hash(subscription.endpoint)]);
      if (Number(count[0]?.n ?? 0) >= 10) throw new ForbiddenException('Máximo de 10 navegadores por cuenta');
      await connection.query(`INSERT INTO web_push_subscription (endpoint_hash, endpoint, user_id, p256dh, auth, binding)
        VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE endpoint = VALUES(endpoint), user_id = VALUES(user_id),
        p256dh = VALUES(p256dh), auth = VALUES(auth), binding = VALUES(binding), last_seen_at = CURRENT_TIMESTAMP(3)`,
      [hash(subscription.endpoint), subscription.endpoint, userId, subscription.keys.p256dh, subscription.keys.auth, subscription.binding]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async remove(userId: string, identity: WebPushIdentity): Promise<number> {
    const [result] = await this.pool.query<ResultSetHeader>(
      'DELETE FROM web_push_subscription WHERE endpoint_hash = ? AND user_id = ? AND binding = ?',
      [hash(identity.endpoint), userId, identity.binding]);
    return result.affectedRows ?? 0;
  }

  async recipients(plantId: string): Promise<OwnedWebPushSubscription[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT s.*, u.role, u.plant FROM web_push_subscription s
      JOIN users u ON u.id = s.user_id WHERE u.is_active = 1`);
    return rows.filter((r) => recibeAvisosDe(String(r.role), r.plant as string | null, plantId)).map(mapRow);
  }

  async current(userId: string, identity: WebPushIdentity, plantIds: readonly string[]): Promise<OwnedWebPushSubscription | null> {
    if (!plantIds.length) return null;
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT s.*, u.role, u.plant FROM web_push_subscription s
      JOIN users u ON u.id = s.user_id
      WHERE s.endpoint_hash = ? AND s.user_id = ? AND s.binding = ? AND u.is_active = 1 LIMIT 1`,
    [hash(identity.endpoint), userId, identity.binding]);
    const r = rows[0];
    return r && plantIds.every((plant) => recibeAvisosDe(String(r.role), r.plant as string | null, plant)) ? mapRow(r) : null;
  }
}
