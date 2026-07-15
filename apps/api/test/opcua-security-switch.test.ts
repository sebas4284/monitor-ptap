/**
 * Prueba real (Fase 4, criterio de aceptación): conmutar .env a SignAndEncrypt +
 * UserName/Certificate debe conectar SIN tocar código. Levanta un OPCUAServer local
 * real (no un mock) que exige SignAndEncrypt+Basic256Sha256, y construye el adaptador
 * directamente desde loadConnectivityConfig() + una LoadedMapping mínima con UN target
 * (session.read([]) con array vacío responde BadNothingToDo — no es válido en OPC UA
 * Part 4; el target apunta al objeto estándar Server (i=2253), siempre presente). No
 * probamos resolución de NodeIds del dominio aquí (eso ya lo cubre bridge.test.ts),
 * solo el handshake de sesión bajo cada combinación de seguridad/identidad.
 *
 * Alcance del segundo caso (OPC_IDENTITY=certificate): prueba end-to-end que el
 * adaptador establece sesión usando el certificado de cliente que
 * OPCUACertificateManager autogenera en disco, y que el servidor de prueba lo acepta.
 * No prueba que FactoryTalk Optix específicamente lo acepte (eso depende de la
 * configuración de esa planta — ver docs/OPTIX_CLIENT_CERT_TRUST.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPCUAServer, MessageSecurityMode, SecurityPolicy } from 'node-opcua';
import { OpcUaConnectivityAdapter } from '../src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter';
import { loadConnectivityConfig } from '../src/infrastructure/connectivity/connectivity.config';
import type { LoadedMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';

const TEST_PORT = 48414;
const TEST_USER = 'ptap-gateway-test';
const TEST_PASSWORD = 'test-password-only-for-local-suite';

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const keys = Object.keys(overrides);
  const saved = new Map<string, string | undefined>();
  for (const k of keys) saved.set(k, process.env[k]);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const k of keys) {
      const v = saved.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

const UA_NS_URI = 'http://opcfoundation.org/UA/'; // ns=0, siempre presente en cualquier servidor OPC UA

/**
 * Un target apuntando al objeto estándar "Server" (i=2253, siempre existe): suficiente
 * para que resolveTargets() tenga algo que leer (session.read([]) con array vacío
 * responde BadNothingToDo — no es un caso válido de OPC UA Part 4). No probamos
 * resolución de NodeIds del dominio aquí, eso ya lo cubre bridge.test.ts.
 */
function minimalMapping(): LoadedMapping {
  return {
    version: '0.0.0-test',
    protocolVersion: 'v1',
    dtoVersion: 'v1',
    plants: [],
    targets: [
      {
        plantId: 'test',
        browseName: 'TEST_SERVER_OBJECT',
        channel: 'realIn',
        node: { nsUri: UA_NS_URI, identifier: 'i=2253' },
        arrayLength: null,
        dataType: null,
      },
    ],
    signals: [],
    raw: { plants: [{ opcBuffers: { realIn: [{ node: { nsUri: UA_NS_URI } }] } }] },
  };
}

async function startSecureTestServer(): Promise<OPCUAServer> {
  const server = new OPCUAServer({
    port: TEST_PORT,
    hostname: '127.0.0.1', // fuerza que el endpoint se anuncie en 127.0.0.1 (coincide con OPC_ENDPOINT)
    securityModes: [MessageSecurityMode.SignAndEncrypt],
    securityPolicies: [SecurityPolicy.Basic256Sha256],
    allowAnonymous: false,
    userManager: {
      // Firma real: (username, password) => boolean — sin `session` como primer arg
      // (a diferencia de isValidUser(session, username, password) en el server interno).
      isValidUser: (userName: string, password: string) => userName === TEST_USER && password === TEST_PASSWORD,
    },
  });
  await server.start();
  return server;
}

test('security: OPC_IDENTITY=username + SignAndEncrypt/Basic256Sha256 conecta por env, sin tocar código', async () => {
  const server = await startSecureTestServer();
  try {
    await withEnv(
      {
        CONNECTIVITY_PROVIDER: 'opcua',
        OPC_ENDPOINT: `opc.tcp://127.0.0.1:${TEST_PORT}`,
        OPC_ENDPOINT_MUST_EXIST: 'false',
        OPC_SECURITY_MODE: 'SignAndEncrypt',
        OPC_SECURITY_POLICY: 'Basic256Sha256',
        OPC_IDENTITY: 'username',
        OPC_USERNAME: TEST_USER,
        OPC_PASSWORD: TEST_PASSWORD,
        OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE: 'true', // bootstrap: acepta el cert autofirmado del server de prueba
      },
      async () => {
        const config = loadConnectivityConfig();
        const adapter = new OpcUaConnectivityAdapter(config.opcua, minimalMapping());
        try {
          await adapter.start();
          assert.equal(adapter.getBridgeStatus(), 'Connected');
        } finally {
          await adapter.stop();
        }
      },
    );
  } finally {
    await server.shutdown();
  }
});

test('security: OPC_IDENTITY=certificate usa el certificado de cliente autogenerado por env, sin tocar código', async () => {
  const server = await startSecureTestServer();
  try {
    await withEnv(
      {
        CONNECTIVITY_PROVIDER: 'opcua',
        OPC_ENDPOINT: `opc.tcp://127.0.0.1:${TEST_PORT}`,
        OPC_ENDPOINT_MUST_EXIST: 'false',
        OPC_SECURITY_MODE: 'SignAndEncrypt',
        OPC_SECURITY_POLICY: 'Basic256Sha256',
        OPC_IDENTITY: 'certificate',
        OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE: 'true',
      },
      async () => {
        const config = loadConnectivityConfig();
        assert.equal(config.opcua.identity.type, 'certificate');
        const adapter = new OpcUaConnectivityAdapter(config.opcua, minimalMapping());
        try {
          await adapter.start();
          assert.equal(adapter.getBridgeStatus(), 'Connected');
        } finally {
          await adapter.stop();
        }
      },
    );
  } finally {
    await server.shutdown();
  }
});
