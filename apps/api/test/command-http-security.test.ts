import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { readTrustedProxies } from '../src/infrastructure/http-hardening.config';
import { requestEvidence } from '../src/infrastructure/audit/request-evidence';
import { commandRateLimiter } from '../src/infrastructure/command-rate-limiter';
import type { AuditEntry, AuditLogService } from '../src/infrastructure/audit/audit-log.service';

test('proxy allowlist rejects implicit trust and all-network ranges', () => {
  assert.equal(readTrustedProxies(''), false);
  assert.deepEqual(readTrustedProxies('127.0.0.1, ::1/128,10.1.2.0/24'), ['127.0.0.1', '::1/128', '10.1.2.0/24']);
  for (const raw of ['true','1','loopback','0.0.0.0/0','::/0','10.0.0.1/33','::1/129','127.0.0.1,','host.invalid','127.0.0.1/32/1']) {
    assert.throws(() => readTrustedProxies(raw), /TRUSTED_PROXY_CIDRS/);
  }
});

test('direct clients cannot forge audit IP with forwarded headers; only allowlisted peers may forward', async () => {
  const app = express();
  app.set('trust proxy', readTrustedProxies(''));
  app.get('/', (req,res) => res.json({ ip: req.ip, evidence: requestEvidence(req,res) }));
  const forged = await request(app).get('/').set('X-Forwarded-For','198.51.100.8').expect(200);
  assert.notEqual(forged.body.ip, '198.51.100.8');
  app.set('trust proxy', readTrustedProxies('10.2.0.0/16'));
  const untrusted = await request(app).get('/').set('X-Forwarded-For','198.51.100.8').expect(200);
  assert.notEqual(untrusted.body.ip, '198.51.100.8');
  app.set('trust proxy', readTrustedProxies('127.0.0.1,::1'));
  const proxied = await request(app).get('/').set('X-Forwarded-For','198.51.100.8').expect(200);
  assert.equal(proxied.body.ip, '198.51.100.8');
  assert.ok(proxied.body.evidence.peerIp);
});

test('request evidence is server-generated, bounded and correlates retries without accepting client IDs', async () => {
  const app = express();
  app.get('/', (req,res) => {
    const first = requestEvidence(req,res);
    assert.deepEqual(requestEvidence(req,res),first);
    res.json(first);
  });
  const first = await request(app).get('/').set('X-Request-ID','forged-id').set('User-Agent','x'.repeat(800)).expect(200);
  const second = await request(app).get('/').expect(200);
  assert.match(first.body.requestId,/^[a-f0-9-]{36}$/);
  assert.equal(first.body.requestId,first.headers['x-request-id']);
  assert.notEqual(first.body.requestId,second.body.requestId);
  assert.equal(first.body.userAgent.length,512);
});

test('command flood is rejected and audited without another command execution; OPTIONS does not consume quota', async () => {
  const records: AuditEntry[] = [];
  let executions = 0;
  const app = express();
  app.set('trust proxy', false);
  const audit = { record: async (entry: AuditEntry) => { records.push(entry); } } as unknown as AuditLogService;
  app.use('/api/plants/:plantId/commands',commandRateLimiter({windowMs:60000,max:2},audit));
  app.options('/api/plants/:plantId/commands', (_req,res) => { res.sendStatus(204); });
  app.post('/api/plants/:plantId/commands', (_req,res) => { executions++; res.sendStatus(202); });
  await request(app).options('/api/plants/soledad/commands').expect(204);
  await request(app).post('/api/plants/soledad/commands').expect(202);
  await request(app).post('/api/plants/cabuyo/commands').expect(202);
  const rejected = await request(app).post('/api/plants/cabuyo/commands').set('X-Forwarded-For','198.51.100.9').expect(429);
  assert.equal(executions,2);
  assert.equal(records.length,1);
  assert.equal(records[0].eventType,'command.rate_limited');
  assert.equal(records[0].userId,null);
  assert.notEqual(records[0].ip,'198.51.100.9');
  assert.equal((records[0].detail?.request as {requestId:string}).requestId,rejected.headers['x-request-id']);
});
