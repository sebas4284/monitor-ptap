import { ECDH } from 'node:crypto';
import { z } from 'zod';

/** Fixed vendor origins: an authenticated caller must never turn push into an HTTP proxy. */
export function validPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (!/^[\x21-\x7e]+$/.test(value) || value.includes('\\')) return false;
    return url.hostname === 'fcm.googleapis.com'
      || url.hostname === 'updates.push.services.mozilla.com'
      || url.hostname === 'web.push.apple.com'
      || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
  } catch { return false; }
}

function base64Key(value: string, bytes: number): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').length === bytes
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}

export const pushEndpointSchema = z.string().min(1).max(2048).refine(validPushEndpoint, 'Proveedor Web Push no permitido');
const publicKey = z.string().refine((value) => {
  if (!base64Key(value, 65)) return false;
  try { ECDH.convertKey(Buffer.from(value, 'base64url'), 'prime256v1'); return true; } catch { return false; }
}, 'Clave pública Web Push inválida');
export const webPushIdentitySchema = z.object({ endpoint: pushEndpointSchema, binding: z.uuid() });
export const webPushSubscriptionSchema = webPushIdentitySchema.extend({
  keys: z.object({ p256dh: publicKey, auth: z.string().refine((value) => base64Key(value, 16), 'Clave auth inválida') }),
});
export type WebPushIdentity = z.infer<typeof webPushIdentitySchema>;
export type WebPushSubscription = z.infer<typeof webPushSubscriptionSchema>;
