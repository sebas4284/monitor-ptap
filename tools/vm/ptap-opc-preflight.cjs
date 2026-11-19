#!/usr/bin/env node
'use strict';

// Read-only OPC UA inspection. Run from the repository root using the deployed Node.
// No .env/production PKI edits, PLC writes, methods, subscriptions or auth retries.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { X509Certificate } = require('node:crypto');

function normalizeFingerprint(value) {
  if (!/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})$/.test(value || '')) {
    throw new Error('EXPECTED_SHA256_REQUIRED');
  }
  return value.replaceAll(':', '').toUpperCase();
}

function validatePin(certificate, expected, now = Date.now()) {
  const pin = normalizeFingerprint(expected);
  const x509 = new X509Certificate(certificate);
  if (normalizeFingerprint(x509.fingerprint256) !== pin) throw new Error('SERVER_PIN_MISMATCH');
  if (now < Date.parse(x509.validFrom) || now > Date.parse(x509.validTo)) {
    throw new Error('SERVER_CERTIFICATE_OUTSIDE_VALIDITY');
  }
  if (x509.ca) throw new Error('APPLICATION_CERTIFICATE_REQUIRED');
  return x509;
}

function selectSecureEndpoint(endpoints, endpointUrl, policy, expected) {
  const pin = normalizeFingerprint(expected);
  const selected = endpoints.find(ep => ep.endpointUrl === endpointUrl && ep.securityMode === 3 &&
    ep.securityPolicyUri === `http://opcfoundation.org/UA/SecurityPolicy#${policy}` &&
    ep.userIdentityTokens.some(token => token.tokenType === 1));
  if (!selected) throw new Error('AUTHENTICATED_ENCRYPTED_ENDPOINT_UNAVAILABLE');
  validatePin(selected.serverCertificate, pin);
  return selected;
}

function parseArgs(argv) {
  const options = { secureRead: false, envFile: '.env', policy: 'Aes256_Sha256_RsaPss' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--secure-read') options.secureRead = true;
    else if (['--env-file', '--server-cert', '--server-sha256', '--policy'].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      options[({ '--env-file': 'envFile', '--server-cert': 'serverCert', '--server-sha256': 'serverSha256', '--policy': 'policy' })[arg]] = argv[++i];
    } else throw new Error('INVALID_ARGUMENTS');
  }
  if (!['Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss'].includes(options.policy)) {
    throw new Error('UNSUPPORTED_SECURE_POLICY');
  }
  if (options.secureRead) {
    normalizeFingerprint(options.serverSha256);
    if (!options.serverCert) throw new Error('INDEPENDENTLY_VERIFIED_SERVER_CERT_REQUIRED');
  }
  return options;
}

function certificateSummary(bytes) {
  if (!bytes?.length) return null;
  const cert = new X509Certificate(bytes);
  return { sha256: cert.fingerprint256, validFrom: cert.validFrom, validTo: cert.validTo };
}

async function run(options) {
  // Dependencies come from the existing deployment; this tool installs nothing.
  const { OPCUAClient, OPCUACertificateManager, MessageSecurityMode, SecurityPolicy, UserTokenType, AttributeIds } = require('node-opcua');
  const env = require('dotenv').parse(fs.readFileSync(options.envFile));
  if (!env.OPC_ENDPOINT || !env.OPC_ENDPOINT.startsWith('opc.tcp://')) throw new Error('OPC_ENDPOINT_REQUIRED');
  const pkiRoot = path.resolve('apps/api/pki');
  const certificateFile = path.join(pkiRoot, 'own/certs/client_certificate.pem');
  const privateKeyFile = path.join(pkiRoot, 'own/private/private_key.pem');
  if (!fs.existsSync(certificateFile) || !fs.existsSync(privateKeyFile)) throw new Error('EXISTING_CLIENT_IDENTITY_REQUIRED');
  // Validate supplied material before making any network connection or loading credentials.
  let verifiedServer;
  if (options.secureRead) {
    verifiedServer = validatePin(fs.readFileSync(options.serverCert), options.serverSha256);
    if (env.OPC_IDENTITY !== 'username' || !env.OPC_USERNAME || !env.OPC_PASSWORD) throw new Error('CONFIGURED_USERNAME_IDENTITY_REQUIRED');
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptap-opc-preflight-'));
  fs.chmodSync(temporaryRoot, 0o700);
  let client;
  let session;
  let manager;
  try {
    // Separate store prevents discovery/rejections/trust bookkeeping touching production PKI.
    manager = new OPCUACertificateManager({ rootFolder: temporaryRoot, automaticallyAcceptUnknownCertificate: false });
    const base = {
      applicationName: 'monitor-ptap-gateway', certificateFile, privateKeyFile,
      clientCertificateManager: manager, endpointMustExist: true, keepSessionAlive: false,
      connectionStrategy: { maxRetry: 0 }, transportTimeout: 10000,
    };
    client = OPCUAClient.create({ ...base, securityMode: MessageSecurityMode.None, securityPolicy: SecurityPolicy.None });
    await client.connect(env.OPC_ENDPOINT);
    const endpoints = await client.getEndpoints();
    const summary = {
      utc: new Date().toISOString(), mode: options.secureRead ? 'secure-read' : 'discovery-only',
      clientCertificate: certificateSummary(fs.readFileSync(certificateFile)),
      endpoints: endpoints.map(ep => ({ configuredUrlMatches: ep.endpointUrl === env.OPC_ENDPOINT,
        securityMode: MessageSecurityMode[ep.securityMode], securityPolicy: ep.securityPolicyUri.split('#').pop(),
        securityLevel: ep.securityLevel, identityTypes: ep.userIdentityTokens.map(token => UserTokenType[token.tokenType]),
        certificate: certificateSummary(ep.serverCertificate) })),
      authenticated: false, plantWrites: 0,
    };
    await client.disconnect();
    await manager.dispose(); // the client releases its reference; the caller owns the store.
    client = undefined;
    manager = undefined;
    if (options.secureRead) {
      const selected = selectSecureEndpoint(endpoints, env.OPC_ENDPOINT, options.policy, options.serverSha256);
      manager = new OPCUACertificateManager({ rootFolder: temporaryRoot, automaticallyAcceptUnknownCertificate: false });
      await manager.initialize();
      // Only independently verified bytes enter this temporary trust store.
      await manager.trustCertificate(verifiedServer.raw);
      const validation = await manager.checkCertificate(verifiedServer.raw);
      if (!validation.isGood()) throw new Error(`SERVER_CERTIFICATE_VALIDATION_${validation.name}`);
      client = OPCUAClient.create({ ...base, clientCertificateManager: manager,
        securityMode: MessageSecurityMode.SignAndEncrypt, securityPolicy: SecurityPolicy[options.policy],
        serverCertificate: verifiedServer.raw });
      await client.connect(env.OPC_ENDPOINT);
      // One authentication attempt, exclusively after pinned, validated SignAndEncrypt connection.
      session = await client.createSession({ type: UserTokenType.UserName, userName: env.OPC_USERNAME, password: env.OPC_PASSWORD });
      const value = await session.read({ nodeId: 'ns=0;i=2258', attributeId: AttributeIds.Value });
      if (!value.statusCode.isGood()) throw new Error(`SERVER_READ_${value.statusCode.name}`);
      summary.authenticated = true;
      summary.selectedPolicy = selected.securityPolicyUri.split('#').pop();
      summary.serverTimeReadStatus = value.statusCode.name;
    }
    return summary;
  } finally {
    if (session) await session.close().catch(() => {});
    if (client) await client.disconnect().catch(() => {});
    if (manager) await manager.dispose().catch(() => {});
    // Only the exact directory returned by mkdtemp above is removed.
    if (path.dirname(temporaryRoot) === os.tmpdir() && path.basename(temporaryRoot).startsWith('ptap-opc-preflight-')) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

module.exports = { normalizeFingerprint, validatePin, selectSecureEndpoint, parseArgs, run };
if (require.main === module || process.argv[1] === '-') {
  const timeout = setTimeout(() => { console.error('PREFLIGHT_TIMEOUT'); process.exit(2); }, 45000);
  Promise.resolve().then(() => run(parseArgs(process.argv.slice(2))))
    .then(result => console.log('PREFLIGHT_RESULT ' + JSON.stringify(result)))
    .catch(error => { console.error('PREFLIGHT_FAILED ' + JSON.stringify({
      // Raw OPC errors can contain endpoints or identity data. Emit only bounded status identifiers.
      code: /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : 'OPC_OPERATION_FAILED',
      status: error.statusCode?.name || null,
    })); process.exitCode = 1; })
    .finally(() => clearTimeout(timeout));
}
