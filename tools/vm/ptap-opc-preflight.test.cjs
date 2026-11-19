'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { X509Certificate } = require('node:crypto');
const { OPCUAServer, OPCUACertificateManager, MessageSecurityMode, SecurityPolicy } = require('node-opcua');
const { parseArgs, run } = require('./ptap-opc-preflight.cjs');

test('secure read rejects absent pin, absent certificate and insecure policy before network', () => {
  assert.throws(() => parseArgs(['--secure-read']), /EXPECTED_SHA256_REQUIRED/);
  assert.throws(() => parseArgs(['--secure-read', '--server-sha256', 'AB'.repeat(32)]), /INDEPENDENTLY_VERIFIED_SERVER_CERT_REQUIRED/);
  assert.throws(() => parseArgs(['--policy', 'None']), /UNSUPPORTED_SECURE_POLICY/);
});

test('real encrypted read: no discovery authentication, mismatched pin blocks, verified peer authenticates once', { timeout: 60000 }, async () => {
  const originalCwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptap-opc-preflight-test-'));
  let server;
  let clientManager;
  let serverManager;
  let authenticationAttempts = 0;
  try {
    process.chdir(root);
    const pki = path.join(root, 'apps/api/pki');
    clientManager = new OPCUACertificateManager({ rootFolder: pki, automaticallyAcceptUnknownCertificate: false });
    await clientManager.initialize();
    const certificateFile = path.join(pki, 'own/certs/client_certificate.pem');
    await clientManager.createSelfSignedCertificate({ applicationUri: `urn:${os.hostname()}:monitor-ptap-gateway`,
      dns: [os.hostname()], subject: '/CN=preflight-client-test', outputFile: certificateFile, validity: 30 });
    serverManager = new OPCUACertificateManager({ rootFolder: path.join(root, 'server-pki'), automaticallyAcceptUnknownCertificate: false });
    server = new OPCUAServer({ port: 0, serverCertificateManager: serverManager,
      securityModes: [MessageSecurityMode.SignAndEncrypt], securityPolicies: [SecurityPolicy.Aes256_Sha256_RsaPss], allowAnonymous: false,
      userManager: { isValidUser: (name, password) => { authenticationAttempts++; return name === 'synthetic-user' && password === 'synthetic-password'; } } });
    await server.start();
    await serverManager.trustCertificate(new X509Certificate(fs.readFileSync(certificateFile)).raw);
    const endpoint = server.endpoints[0].endpointDescriptions().find(ep => ep.securityMode === MessageSecurityMode.SignAndEncrypt).endpointUrl;
    fs.writeFileSync('.env', `OPC_ENDPOINT=${endpoint}\nOPC_IDENTITY=username\nOPC_USERNAME=synthetic-user\nOPC_PASSWORD=synthetic-password\n`);
    const certPath = path.join(root, 'verified-server.pem');
    const cert = new X509Certificate(server.getCertificate());
    fs.writeFileSync(certPath, cert.toString());
    const discovered = await run(parseArgs([]));
    assert.equal(discovered.authenticated, false);
    assert.equal(authenticationAttempts, 0);
    const args = ['--secure-read', '--server-cert', certPath, '--server-sha256'];
    await assert.rejects(run(parseArgs([...args, 'AB'.repeat(32)])), /SERVER_PIN_MISMATCH/);
    assert.equal(authenticationAttempts, 0);
    const before = fs.readdirSync(path.join(pki, 'trusted/certs'));
    const result = await run(parseArgs([...args, cert.fingerprint256]));
    assert.equal(result.authenticated, true);
    assert.equal(result.selectedPolicy, 'Aes256_Sha256_RsaPss');
    assert.equal(result.serverTimeReadStatus, 'Good');
    assert.equal(result.plantWrites, 0);
    assert.equal(authenticationAttempts, 1);
    assert.deepEqual(fs.readdirSync(path.join(pki, 'trusted/certs')), before, 'production client store unchanged');
  } finally {
    if (server) await server.shutdown();
    if (serverManager) await serverManager.dispose();
    if (clientManager) await clientManager.dispose();
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
