import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OpcUaConfig } from '../src/infrastructure/connectivity/connectivity.config';
import type { WriteSecurity } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import { canWriteOnConnection } from '../src/infrastructure/connectivity/write-connection-policy';
import { OpcUaConnectivityAdapter } from '../src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter';

const session: WriteSecurity = { secure: false, securityMode: 'None', identity: 'username' };
const approved = {
  writesEnabled: true, endpoint: 'opc.tcp://test.invalid:59100',
  securityMode: 'None', securityPolicy: 'None',
  identity: { type: 'username', userName: 'test', password: 'synthetic' },
  trustedNetworkWrites: true, trustedNetworkEndpoint: 'opc.tcp://test.invalid:59100',
  trustedNetworkApproval: 'synthetic-operator-approval', allowInsecureWrites: false,
} as OpcUaConfig;

test('write connection: explicit endpoint approval allows username on the trusted network without claiming encryption', () => {
  assert.equal(canWriteOnConnection(approved, session), true);
  assert.equal(session.secure, false);
});

for (const [name, change] of Object.entries({
  'writes disabled': { writesEnabled: false },
  'approval disabled': { trustedNetworkWrites: false },
  'approval missing': { trustedNetworkApproval: undefined },
  'approval blank': { trustedNetworkApproval: '  ' },
  'endpoint unapproved': { trustedNetworkEndpoint: undefined },
  'endpoint changed': { endpoint: 'opc.tcp://other.invalid:59100' },
  'anonymous config': { identity: { type: 'anonymous' } },
  'unsupported security mode': { securityMode: 'unexpected' },
})) {
  test(`write connection: ${name} rejects the exception`, () => {
    assert.equal(canWriteOnConnection({ ...approved, ...change } as OpcUaConfig, session), false);
  });
}

test('write connection: anonymous session and old insecure flag never authorize the exception', () => {
  assert.equal(canWriteOnConnection(approved, { ...session, identity: 'anonymous' }), false);
  assert.equal(canWriteOnConnection({ ...approved, trustedNetworkWrites: false, allowInsecureWrites: true }, session), false);
});

test('write connection: encrypted authenticated sessions retain the default path and the master switch', () => {
  const secure = { ...session, secure: true, securityMode: 'SignAndEncrypt' };
  assert.equal(canWriteOnConnection({ ...approved, trustedNetworkWrites: false }, secure), true);
  assert.equal(canWriteOnConnection({ ...approved, writesEnabled: false }, secure), false);
});

test('real adapter: explicit approval reaches target resolution; endpoint drift rejects before any I/O', async () => {
  const adapter = Object.create(OpcUaConnectivityAdapter.prototype);
  adapter.config = { ...approved };
  adapter.findResolvedElement = () => { throw new Error('SYNTHETIC_TARGET_RESOLUTION'); };
  assert.equal(adapter.getWriteSecurity().secure, false);
  await assert.rejects(() => adapter.writeBufferElement({}, 1), /SYNTHETIC_TARGET_RESOLUTION/);
  adapter.config.endpoint = 'opc.tcp://other.invalid:59100';
  await assert.rejects(() => adapter.writeBufferElement({}, 1), /WRITES_DISABLED_INSECURE_SESSION/);
});
