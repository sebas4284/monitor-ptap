import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpcUaConnectivityAdapter } from '../src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';

// No constructors, sessions or network: exercise the actual adapter's security decision.
function adapter(type: typeof OpcUaConnectivityAdapter | typeof SimulatorBridgeAdapter, secure = false) {
  const value = Object.create(type.prototype);
  value.config = { writesEnabled: true, allowInsecureWrites: true,
    securityMode: secure ? 'SignAndEncrypt' : 'None',
    identity: secure ? { type: 'username', userName: 'test', password: 'synthetic' } : { type: 'anonymous' } };
  return value as OpcUaConnectivityAdapter;
}
test('OT01: legacy insecure flag cannot authorize anonymous plaintext writes', () => {
  assert.equal(adapter(OpcUaConnectivityAdapter).getWriteSecurity().secure, false);
  assert.equal(adapter(SimulatorBridgeAdapter).getWriteSecurity().secure, false);
});
test('OT01: authenticated encrypted configuration remains available', () => {
  assert.equal(adapter(OpcUaConnectivityAdapter, true).getWriteSecurity().secure, true);
});
test('OT01: real low-level write rejects an insecure session before resolving a target', async () => {
  await assert.rejects(() => adapter(OpcUaConnectivityAdapter).writeBufferElement({} as never, 1), /WRITES_DISABLED_INSECURE_SESSION/);
});
