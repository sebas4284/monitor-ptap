import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadArgs } from '../scripts/read-opcua-node';

test('parseReadArgs uses explicit node and endpoint values', () => {
  const result = parseReadArgs(['--node', 'ns=2;s=Device1.Tag1', '--endpoint', 'opc.tcp://example:4840']);

  assert.equal(result.nodeId, 'ns=2;s=Device1.Tag1');
  assert.equal(result.endpoint, 'opc.tcp://example:4840');
  assert.equal(result.securityMode, 'None');
  assert.equal(result.securityPolicy, 'None');
  assert.deepEqual(result.identity, { type: 'anonymous' });
});

test('parseReadArgs supports username identity from flags', () => {
  const result = parseReadArgs(['--node', 'ns=2;s=Device1.Tag1', '--identity', 'username', '--username', 'admin', '--password', 'secret']);

  assert.deepEqual(result.identity, { type: 'username', userName: 'admin', password: 'secret' });
});
