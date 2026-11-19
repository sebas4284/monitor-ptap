import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { NOTIFICATION_PREFS_DEFAULT as DEFAULT_NOTIFICATION_PREFS } from '@ptap/shared';
import { WebPushDispatcher } from '../src/modules/notifications/web-push.dispatcher';
import { WebPushRepository, type OwnedWebPushSubscription } from '../src/modules/notifications/web-push.repository';
import { webPushSubscriptionSchema, validPushEndpoint } from '../src/modules/notifications/web-push.dto';
import { createWebPushSender, type WebPushPayload, type WebPushSender } from '../src/modules/notifications/web-push.sender';
import { NotificationRepository, type CreatedNotification } from '../src/modules/notifications/notification.repository';
import { NotificationPrefsRepository } from '../src/modules/notifications/notification-prefs.repository';

const key = createECDH('prime256v1'); key.generateKeys();
const subscription: OwnedWebPushSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-only', userId: 'alice', binding: randomUUID(),
  keys: { p256dh: key.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') },
};
const notice = (id: number, plantId = 'km18', severity: CreatedNotification['severity'] = 'critical'): CreatedNotification => ({
  id, plantId, severity, kind: 'sensor_stale', subject: null, title: 'Aviso', message: 'Mensaje', day: '2026-11-02', createdAt: '2026-11-02T12:00:00Z',
});

function fixture() {
  let current: OwnedWebPushSubscription | null = { ...subscription };
  let authorizedPlants = ['km18'];
  const sent: WebPushPayload[] = [];
  const removed: string[] = [];
  const checks: string[][] = [];
  const sender: WebPushSender = { publicKey: 'test', send: async (_s, p) => { sent.push(p); } };
  const repository = {
    recipients: async (plant: string) => authorizedPlants.includes(plant) && current ? [{ ...current }] : [],
    current: async (userId: string, identity: typeof subscription, plants: string[]) => {
      checks.push(plants);
      return current && userId === current.userId && identity.binding === current.binding
        && plants.every((p) => authorizedPlants.includes(p)) ? { ...current } : null;
    },
    remove: async (userId: string, identity: typeof subscription) => {
      if (current?.userId !== userId || current.binding !== identity.binding) return 0;
      removed.push(identity.binding); current = null; return 1;
    },
  } as unknown as WebPushRepository;
  const prefs = { get: async () => DEFAULT_NOTIFICATION_PREFS } as unknown as NotificationPrefsRepository;
  const notifications = new NotificationRepository({} as Pool);
  const dispatcher = new WebPushDispatcher(repository, prefs, notifications, { sender, now: () => new Date('2026-11-02T12:00:00Z') });
  return { dispatcher, sender, prefs, repository, sent, checks, removed,
    replace: (value: OwnedWebPushSubscription | null) => { current = value; },
    plants: (value: string[]) => { authorizedPlants = value; } };
}

test('Web Push rejects SSRF origins, credentials, ports and lookalike domains', () => {
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://[::1]/',
    'https://fcm.googleapis.com.attacker.example/x', 'https://attacker.example/?fcm.googleapis.com',
    'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com/x#fragment', 'https://notify.windows.com.evil/x',
    'https://fcm.googleapis.com\\@attacker.example/x']) assert.equal(validPushEndpoint(endpoint), false, endpoint);
  for (const endpoint of [subscription.endpoint, 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/x', 'https://wns2-bl2p.notify.windows.com/x']) assert.equal(validPushEndpoint(endpoint), true, endpoint);
});

test('Web Push requires real P-256 point, 16-byte auth and UUID binding', () => {
  assert.equal(webPushSubscriptionSchema.safeParse(subscription).success, true);
  assert.equal(webPushSubscriptionSchema.safeParse({ ...subscription, binding: 'alice' }).success, false);
  assert.equal(webPushSubscriptionSchema.safeParse({ ...subscription, keys: { ...subscription.keys, auth: 'x' } }).success, false);
  assert.equal(webPushSubscriptionSchema.safeParse({ ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65).toString('base64url') } }).success, false);
});

test('Web Push missing or mismatched VAPID is off; valid configuration creates sender without sending', () => {
  assert.equal(createWebPushSender({}), null);
  assert.equal(createWebPushSender({ WEB_PUSH_VAPID_PUBLIC_KEY: 'invalid', WEB_PUSH_VAPID_PRIVATE_KEY: 'invalid', WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com' }), null);
  const sender = createWebPushSender({ WEB_PUSH_VAPID_PUBLIC_KEY: key.getPublicKey().toString('base64url'),
    WEB_PUSH_VAPID_PRIVATE_KEY: key.getPrivateKey().toString('base64url'), WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com' });
  assert.equal(sender?.publicKey, subscription.keys.p256dh);
});

test('Web Push respects preferences, scope and sends worker binding', async () => {
  const f = fixture();
  f.dispatcher.enqueue(notice(1)); f.dispatcher.enqueue(notice(2, 'other'));
  await f.dispatcher.flush();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0]?.binding, subscription.binding);
  assert.equal(f.sent[0]?.critical, true);
  assert.deepEqual(f.checks, [['km18']]);
  f.prefs.get = async () => ({ ...DEFAULT_NOTIFICATION_PREFS, mutedKinds: ['sensor_stale'] });
  f.dispatcher.enqueue(notice(3)); await f.dispatcher.flush();
  assert.equal(f.sent.length, 1);
});

test('Web Push account replacement while preferences wait prevents stale delivery', async () => {
  const f = fixture();
  f.prefs.get = async () => { f.replace({ ...subscription, userId: 'bob', binding: randomUUID() }); return DEFAULT_NOTIFICATION_PREFS; };
  f.dispatcher.enqueue(notice(1)); await f.dispatcher.flush();
  assert.equal(f.sent.length, 0);
});

test('Web Push rechecks scope before each message and includes every summary source plant', async () => {
  const f = fixture();
  f.sender.send = async (_s, payload) => { f.sent.push(payload); f.plants([]); };
  f.dispatcher.enqueue(notice(1)); f.dispatcher.enqueue(notice(2)); await f.dispatcher.flush();
  assert.equal(f.sent.length, 1);
  const summary = fixture(); summary.plants(['km18', 'other']);
  summary.dispatcher.enqueue(notice(1, 'km18', 'warning'));
  summary.dispatcher.enqueue(notice(2, 'other', 'warning'));
  summary.dispatcher.enqueue(notice(3, 'other', 'warning'));
  await summary.dispatcher.flush();
  assert.equal(summary.sent.length, 1);
  assert.deepEqual(summary.checks[0], ['km18', 'other']);
});

test('Web Push directed test cannot use another owner or binding', async () => {
  const f = fixture();
  assert.equal((await f.dispatcher.sendTest('bob', 'km18', subscription)).telefonos, 0);
  assert.equal((await f.dispatcher.sendTest('alice', 'km18', { ...subscription, binding: randomUUID() })).telefonos, 0);
  assert.equal((await f.dispatcher.sendTest('alice', 'km18', subscription)).enviados, 1);
});

test('Web Push late 410 never removes a new account binding; 503 retains subscription', async () => {
  const f = fixture();
  f.sender.send = async () => { f.replace({ ...subscription, userId: 'bob', binding: randomUUID() }); throw { statusCode: 410 }; };
  assert.equal((await f.dispatcher.sendTest('alice', 'km18', subscription)).fallidos, 1);
  assert.deepEqual(f.removed, []);
  const transient = fixture(); transient.sender.send = async () => { throw { statusCode: 503 }; };
  await transient.dispatcher.sendTest('alice', 'km18', subscription);
  assert.deepEqual(transient.removed, []);
  const dead = fixture(); dead.sender.send = async () => { throw { statusCode: 404 }; };
  await dead.dispatcher.sendTest('alice', 'km18', subscription);
  assert.deepEqual(dead.removed, [subscription.binding]);
});

test('Web Push repository removal and revalidation condition on owner, binding and active account', async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const repo = new WebPushRepository({ query: async (sql: string, params: unknown[]) => {
    calls.push({ sql, params }); return sql.startsWith('DELETE') ? [{ affectedRows: 1 }] : [[]];
  } } as unknown as Pool);
  await repo.remove('alice', subscription);
  await repo.current('alice', subscription, ['km18']);
  assert.match(calls[0]!.sql, /endpoint_hash = \? AND user_id = \? AND binding = \?/);
  assert.deepEqual(calls[0]!.params.slice(1), ['alice', subscription.binding]);
  assert.match(calls[1]!.sql, /s\.user_id = \? AND s\.binding = \? AND u\.is_active = 1/);
});

test('Web Push subscription quota rolls back before INSERT', async () => {
  let inserted = false; let rolledBack = false; let released = false;
  const connection = { beginTransaction: async () => {}, commit: async () => {},
    rollback: async () => { rolledBack = true; }, release: () => { released = true; },
    query: async (sql: string) => {
      if (sql.startsWith('SELECT role')) return [[{ role: 'operador', plant: 'km18' }]];
      if (sql.startsWith('SELECT COUNT')) return [[{ n: 10 }]];
      inserted = true; return [{ affectedRows: 1 }];
    } };
  const repo = new WebPushRepository({ getConnection: async () => connection } as unknown as Pool);
  await assert.rejects(repo.register('alice', subscription), /10 navegadores/);
  assert.equal(inserted, false); assert.equal(rolledBack, true); assert.equal(released, true);
});

test('Independent notification listeners coexist with FCM and isolate failures', async () => {
  const repo = new NotificationRepository({ query: async () => [{ insertId: 42 }] } as unknown as Pool);
  const events: string[] = [];
  repo.onCreated(() => { events.push('fcm'); });
  const unsubscribe = repo.subscribeCreated(() => { events.push('web'); });
  repo.subscribeCreated(() => { throw new Error('listener failure fixture'); });
  await repo.create(notice(1)); await new Promise(setImmediate);
  assert.deepEqual(events.sort(), ['fcm', 'web']);
  unsubscribe(); repo.onCreated(null);
  events.length = 0; await repo.create(notice(2)); await new Promise(setImmediate);
  assert.deepEqual(events, []);
});
