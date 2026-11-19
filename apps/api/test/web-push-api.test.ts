import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WebPushController } from '../src/modules/notifications/web-push.controller';
import { WebPushRepository } from '../src/modules/notifications/web-push.repository';
import { WebPushDispatcher } from '../src/modules/notifications/web-push.dispatcher';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';
import { UsersRepository } from '../src/modules/users/users.repository';

test('Web Push API authenticates and scopes config, register, removal and directed test', async () => {
  const key = createECDH('prime256v1'); key.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-only', binding: randomUUID(),
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: Buffer.alloc(16).toString('base64url') } };
  const registered: unknown[][] = []; const removed: unknown[][] = []; const tested: unknown[][] = [];
  const jwt = { verify: (token: string) => ({ sub: token }) };
  const module = await Test.createTestingModule({
    controllers: [WebPushController],
    providers: [JwtAuthGuard, PermissionGuard,
      { provide: JwtService, useValue: jwt },
      { provide: UsersRepository, useValue: { findById: async (id: string) => id === 'inactive' ? null : ({
        id, role: id === 'civil' ? 'civil' : 'operador', plant: id === 'unscoped' ? null : 'km18',
      }) } },
      { provide: WebPushRepository, useValue: {
        register: async (...args: unknown[]) => { registered.push(args); },
        remove: async (...args: unknown[]) => { removed.push(args); return 0; },
      } },
      { provide: WebPushDispatcher, useValue: { active: false, publicKey: null,
        sendTest: async (...args: unknown[]) => { tested.push(args); return { pushActivo: false, telefonos: 0, enviados: 0, fallidos: 0 }; },
      } },
    ],
  }).compile();
  const app = module.createNestApplication(); app.setGlobalPrefix('api'); app.useLogger(false); await app.init();
  const base = '/api/notifications/web-push';
  try {
    const paths: [string, string][] = [['get', '/config'], ['post', '/subscriptions'], ['post', '/subscriptions/remove'], ['post', '/test']];
    for (const [method, path] of paths) {
      const call = (user?: string) => {
        const req = method === 'get' ? request(app.getHttpServer()).get(base + path) : request(app.getHttpServer()).post(base + path).send(subscription);
        return user ? req.set('Authorization', `Bearer ${user}`) : req;
      };
      await call().expect(401); await call('inactive').expect(401); await call('civil').expect(403); await call('unscoped').expect(403);
    }
    await request(app.getHttpServer()).get(base + '/config').set('Authorization', 'Bearer alice').expect(200, { pushActivo: false, publicKey: null });
    await request(app.getHttpServer()).post(base + '/subscriptions').set('Authorization', 'Bearer alice')
      .send({ ...subscription, userId: 'bob' }).expect(201, { pushActivo: false, binding: subscription.binding });
    assert.equal(registered[0]?.[0], 'alice');
    assert.deepEqual(registered[0]?.[1], subscription);
    await request(app.getHttpServer()).post(base + '/subscriptions').set('Authorization', 'Bearer alice')
      .send({ ...subscription, endpoint: 'https://127.0.0.1/internal' }).expect(400);
    assert.equal(registered.length, 1);
    await request(app.getHttpServer()).post(base + '/subscriptions/remove').set('Authorization', 'Bearer alice').send(subscription).expect(201, { quitado: false });
    assert.equal(removed[0]?.[0], 'alice');
    await request(app.getHttpServer()).post(base + '/test').set('Authorization', 'Bearer alice').send(subscription).expect(201);
    assert.deepEqual(tested[0], ['alice', 'km18', { endpoint: subscription.endpoint, binding: subscription.binding }]);
  } finally { await app.close(); }
});
