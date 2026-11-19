import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PruebaPushDto } from '@ptap/shared';
import { NotificationPrefsRepository } from './notification-prefs.repository';
import { NotificationRepository, type CreatedNotification } from './notification.repository';
import { horaDeColombia, mensajeDePrueba, planDeMensajes, type PushMessage } from './push.dispatcher';
import { webPushSubscriptionSchema, type WebPushIdentity } from './web-push.dto';
import { WebPushRepository, type OwnedWebPushSubscription } from './web-push.repository';
import { createWebPushSender, type WebPushPayload, type WebPushSender } from './web-push.sender';

export const WEB_PUSH_OPTIONS = Symbol('WEB_PUSH_OPTIONS');
export interface WebPushOptions { sender?: WebPushSender | null; windowMs?: number; now?: () => Date }
function payloadOf(message: PushMessage, binding: string): WebPushPayload {
  return { title: message.notification?.title ?? 'Aquora', body: message.notification?.body ?? '',
    tag: message.data?.tag ?? 'aquora', critical: message.android?.notification?.priority === 'max', binding };
}

@Injectable()
export class WebPushDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WebPush');
  private readonly sender: WebPushSender | null;
  private readonly windowMs: number;
  private readonly now: () => Date;
  private pending: CreatedNotification[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe?: () => void;
  constructor(
    @Inject(WebPushRepository) private readonly subscriptions: WebPushRepository,
    @Inject(NotificationPrefsRepository) private readonly prefs: NotificationPrefsRepository,
    @Inject(NotificationRepository) private readonly notifications: NotificationRepository,
    @Optional() @Inject(WEB_PUSH_OPTIONS) options?: WebPushOptions,
  ) {
    this.sender = options?.sender === undefined ? createWebPushSender() : options.sender;
    this.windowMs = options?.windowMs ?? 3000;
    this.now = options?.now ?? (() => new Date());
  }
  get active(): boolean { return Boolean(this.sender); }
  get publicKey(): string | null { return this.sender?.publicKey ?? null; }
  onModuleInit(): void {
    this.unsubscribe = this.notifications.subscribeCreated((n) => this.enqueue(n));
    if (!this.active) this.logger.log('Web Push apagado: falta configuración VAPID válida');
  }
  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
  }
  enqueue(notification: CreatedNotification): void {
    if (!this.sender) return;
    this.pending.push(notification);
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.windowMs);
      this.timer.unref?.();
    }
  }
  /** Provider errors never interrupt persistence or another subscription's delivery. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.pending.splice(0);
    if (!this.sender) return;
    try {
      const recipients = new Map<string, { subscription: OwnedWebPushSubscription; notices: CreatedNotification[] }>();
      for (const plant of new Set(batch.map((n) => n.plantId))) {
        for (const subscription of await this.subscriptions.recipients(plant)) {
          const key = `${subscription.endpoint}|${subscription.userId}|${subscription.binding}`;
          const entry = recipients.get(key) ?? { subscription, notices: [] };
          entry.notices.push(...batch.filter((n) => n.plantId === plant));
          recipients.set(key, entry);
        }
      }
      for (const { subscription, notices } of recipients.values()) {
        try {
          const prefs = await this.prefs.get(subscription.userId);
          // All source plants are revalidated, including multi-plant summaries.
          const plants = [...new Set(notices.map((n) => n.plantId))];
          for (const message of planDeMensajes(notices, prefs, horaDeColombia(this.now()))) {
            await this.deliver(subscription, plants, message);
          }
        } catch { this.logger.warn('No se pudo procesar una suscripción Web Push'); }
      }
    } catch { this.logger.warn('No se pudo repartir la ráfaga Web Push; permanece en bandeja'); }
  }
  private async deliver(subscription: OwnedWebPushSubscription, plants: string[], message: PushMessage): Promise<boolean | null> {
    if (!this.sender) return null;
    const current = await this.subscriptions.current(subscription.userId, subscription, plants);
    if (!current || !webPushSubscriptionSchema.safeParse(current).success) return null;
    try {
      await this.sender.send(current, payloadOf(message, current.binding));
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number } | null)?.statusCode;
      if (status === 404 || status === 410) await this.subscriptions.remove(current.userId, current);
      // Avoid logging endpoint, auth material or provider response body.
      this.logger.warn(`Web Push rechazado (${typeof status === 'number' ? status : 'transporte'})`);
      return false;
    }
  }
  async sendTest(userId: string, plant: string, identity: WebPushIdentity): Promise<PruebaPushDto> {
    const result = { pushActivo: this.active, telefonos: 0, enviados: 0, fallidos: 0 };
    if (!this.sender) return result;
    const current = await this.subscriptions.current(userId, identity, [plant]);
    if (!current) return result;
    result.telefonos = 1;
    const sent = await this.deliver(current, [plant], mensajeDePrueba(plant));
    if (sent === true) result.enviados = 1;
    else if (sent === false) result.fallidos = 1;
    return result;
  }
}
