import { Platform } from 'react-native';
import type { PruebaPushDto } from '@ptap/shared';
import { getAuthToken, getJson, postJsonWithToken } from './api';
import { isNotificationSession, notificationSession, type NotificationSession } from './notification-session';
import type { EstadoPush } from './push-rules';

const DB_NAME = 'aquora-web-push';
const STORE = 'state';
const STATE_KEY = 'current';
const API = '/api/notifications/web-push';
const WORKER = '/aquora-push-sw.js';
interface BindingState { binding: string; endpoint: string; scope: string; active: boolean; intent: string }
let revision = 0;
let stoppedGeneration: number | null = null;
let tail: Promise<unknown> = Promise.resolve();
const inFlight = new Map<number, Promise<EstadoPush>>();

export function webPushSupported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && window.isSecureContext === true &&
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window &&
    'Notification' in window && typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(request.result);
    };
    const timeout = setTimeout(() => finish(new Error('El almacenamiento de avisos no responde')), 4_000);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => { if (settled) request.result.close(); else finish(); };
    request.onerror = () => finish(request.error ?? new Error('No se pudo abrir el almacenamiento de avisos'));
    request.onblocked = () => finish(new Error('El almacenamiento de avisos está bloqueado'));
  });
}

async function within<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('El navegador no respondió al activar los avisos')), 15_000);
    })]);
  } finally { if (timeout) clearTimeout(timeout); }
}

/** The owner check runs inside the read/write transaction, after IndexedDB finishes opening. */
async function updateState(
  update: (previous: BindingState | null) => BindingState | null,
): Promise<BindingState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let previous: BindingState | null = null;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(STATE_KEY);
    request.onsuccess = () => {
      previous = (request.result as BindingState | undefined) ?? null;
      try {
        const next = update(previous);
        if (next) store.put(next, STATE_KEY); else store.delete(STATE_KEY);
      } catch (err) { tx.abort(); reject(err); }
    };
    tx.oncomplete = () => { db.close(); resolve(previous); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('No se pudo guardar el estado de avisos')); };
  });
}

async function readState(): Promise<BindingState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(STATE_KEY);
    request.onsuccess = () => resolve((request.result as BindingState | undefined) ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = tx.onabort = () => db.close();
  });
}

async function closeNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration(WORKER);
  if (!registration) return;
  for (const notification of await registration.getNotifications()) notification.close();
}

/** Local revocation runs before any network queue; it also works when logout is offline. */
async function revokeLocal(): Promise<BindingState | null> {
  revision++;
  stoppedGeneration = notificationSession()?.generation ?? null;
  if (Platform.OS !== 'web' || typeof indexedDB === 'undefined') return null;
  const previous = await updateState(() => null);
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) await closeNotifications();
  return previous;
}

export async function invalidarWebPushLocal(): Promise<void> {
  await revokeLocal();
}

async function post<T>(path: string, body: unknown, token: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await postJsonWithToken<T>(`${API}${path}`, body, token, controller.signal); }
  finally { clearTimeout(timeout); }
}

function keyBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function current(session: NotificationSession, expected: number): boolean {
  return isNotificationSession(session) && revision === expected && stoppedGeneration !== session.generation;
}

export function registrarWebPush(): Promise<EstadoPush> {
  if (!webPushSupported()) return Promise.resolve('no-disponible');
  const session = notificationSession();
  if (!session || stoppedGeneration === session.generation) return Promise.resolve('pendiente');
  const existing = inFlight.get(session.generation);
  if (existing) return existing;
  const expected = revision;
  const execute = () => register(session, expected);
  // Browser-wide lock also orders subscription replacement and provider requests between tabs.
  const result = tail.catch(() => undefined).then(() => navigator.locks
    ? navigator.locks.request('aquora-web-push-registration', execute) : execute())
    .finally(() => inFlight.delete(session.generation));
  tail = result.catch(() => undefined);
  inFlight.set(session.generation, result);
  return result;
}

async function register(session: NotificationSession, expected: number): Promise<EstadoPush> {
  const valid = () => current(session, expected);
  const intent = crypto.randomUUID();
  const owns = (state: BindingState | null) => valid() && state?.intent === intent;
  try {
    if (!valid() || window.Notification.permission !== 'granted') return 'pendiente';
    // Reserve before awaiting external work. Logout or a newer tab invalidates this intent atomically.
    await updateState(previous => valid() ? {
      binding: previous?.scope === session.scope ? previous.binding : '',
      endpoint: previous?.scope === session.scope ? previous.endpoint : '',
      active: previous?.scope === session.scope && previous.active,
      scope: session.scope, intent,
    } : previous);
    if (!valid()) return 'pendiente';
    const config = await within(getJson<{ pushActivo: boolean; publicKey: string | null }>(`${API}/config`));
    if (!valid()) return 'pendiente';
    if (!config.pushActivo || !config.publicKey) {
      await updateState(previous => owns(previous) ? { ...previous!, active: false } : previous);
      return valid() ? 'servidor-apagado' : 'pendiente';
    }
    const registration = await within(navigator.serviceWorker.register(WORKER, { scope: '/', updateViaCache: 'none' }));
    if (!valid()) return 'pendiente';
    await within(navigator.serviceWorker.ready);
    if (!valid()) return 'pendiente';
    let subscription = await registration.pushManager.getSubscription();
    if (!valid()) return 'pendiente';
    const applicationServerKey = keyBytes(config.publicKey);
    if (subscription) {
      const oldKey = subscription.options.applicationServerKey;
      const bytes = oldKey ? new Uint8Array(oldKey) : null;
      const matches = bytes?.length === applicationServerKey.length && applicationServerKey.every((value, index) => bytes[index] === value);
      if (!matches) {
        const previous = await updateState(state => owns(state) ? { ...state!, active: false, binding: '', endpoint: '' } : state);
        if (!owns(previous)) return 'pendiente';
        await within(subscription.unsubscribe());
        if (!valid()) return 'pendiente';
        subscription = null;
      }
    }
    subscription ??= await within(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
    if (!valid()) return 'pendiente';
    const serialized = subscription.toJSON();
    if (!serialized.keys?.p256dh || !serialized.keys.auth) throw new Error('Suscripción incompleta');
    const previous = await readState();
    if (!owns(previous)) return 'pendiente';
    const binding = previous!.binding && previous!.endpoint === subscription.endpoint ? previous!.binding : crypto.randomUUID();
    const body = { endpoint: subscription.endpoint, keys: serialized.keys, binding };
    const response = await post<{ pushActivo: boolean; binding: string }>('/subscriptions', body, session.token);
    if (!valid()) return 'pendiente';
    if (response.binding !== binding) throw new Error('Vinculación de avisos inválida');
    const beforeCommit = await updateState(previous => owns(previous) ? { binding, endpoint: body.endpoint, scope: session.scope, active: response.pushActivo === true, intent } : previous);
    if (!owns(beforeCommit)) return 'pendiente';
    return response.pushActivo === true ? 'activo' : 'servidor-apagado';
  } catch {
    // Failed refresh must never disable fallback or leave another account's binding enabled.
    if (valid()) await updateState(previous => owns(previous) ? { ...previous!, active: false } : previous).catch(() => undefined);
    return valid() ? 'error' : 'pendiente';
  }
}

export async function webPushActivo(): Promise<boolean> {
  if (!webPushSupported()) return false;
  const session = notificationSession();
  if (!session || stoppedGeneration === session.generation || window.Notification.permission !== 'granted') return false;
  const expected = revision;
  try {
    const state = await readState();
    return current(session, expected) && state?.scope === session.scope && state.active === true;
  } catch { return false; }
}

export async function desregistrarWebPush(): Promise<void> {
  const token = getAuthToken();
  // Snapshot and deletion share a transaction, independently of the old registration's network queue.
  const state = await revokeLocal();
  if (token && state?.binding && state.endpoint) await post('/subscriptions/remove', { endpoint: state.endpoint, binding: state.binding }, token, 4_000).catch(() => undefined);
}

export async function probarWebPush(): Promise<PruebaPushDto> {
  const session = notificationSession();
  if (!session) throw new Error('Sesión requerida');
  const expected = revision;
  const state = await readState();
  if (!current(session, expected) || !state || state.scope !== session.scope) throw new Error('Este navegador no está registrado');
  return post<PruebaPushDto>('/test', { endpoint: state.endpoint, binding: state.binding }, session.token);
}
