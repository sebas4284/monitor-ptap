import { createECDH } from 'node:crypto';
import webpush from 'web-push';
import type { WebPushSubscription } from './web-push.dto';

export interface WebPushPayload { title: string; body: string; tag: string; critical: boolean; binding: string }
export interface WebPushSender {
  publicKey: string;
  send(subscription: WebPushSubscription, payload: WebPushPayload): Promise<void>;
}

/** No network or global web-push configuration during startup. Invalid/missing VAPID stays off. */
export function createWebPushSender(env: NodeJS.ProcessEnv = process.env): WebPushSender | null {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  try {
    const pair = createECDH('prime256v1');
    pair.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (pair.getPublicKey().toString('base64url') !== publicKey) return null;
    webpush.getVapidHeaders('https://fcm.googleapis.com', subject, publicKey, privateKey, 'aes128gcm');
  } catch { return null; }
  return {
    publicKey,
    async send(subscription, payload) {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        vapidDetails: { subject, publicKey, privateKey },
        TTL: 300, timeout: 10_000, urgency: payload.critical ? 'high' : 'normal',
      });
    },
  };
}
