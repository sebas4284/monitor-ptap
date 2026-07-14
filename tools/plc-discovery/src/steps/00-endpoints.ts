/**
 * ETAPA 00 — Preflight (GATE).
 * GetEndpoints + establecimiento de sesión + namespaces + OperationLimits + estado del servidor.
 * SOLO LECTURA. No escribe, no llama métodos, no crea subscriptions.
 */
import { AttributeIds, MessageSecurityMode } from 'node-opcua';
import { loadConfig } from '../config';
import { connectReadOnly, probeEndpoints } from '../lib/client';
import { saveArtifact } from '../lib/artifacts';
import { readInBatches } from '../lib/batching';
import type { EndpointsArtifact } from '../types';

// NodeIds estándar (ns=0) de límites de operación y estado del servidor.
const LIMIT_NODES = {
  maxNodesPerRead: 'i=11705',
  maxNodesPerBrowse: 'i=11710',
  maxNodesPerTranslate: 'i=11712',
  maxBrowseContinuationPoints: 'i=2735',
  maxArrayLength: 'i=11702',
} as const;

const SERVER_NODES = {
  state: 'i=2259',
  currentTime: 'i=2258',
  productName: 'i=2261',
  manufacturerName: 'i=2262',
  softwareVersion: 'i=2264',
} as const;

const SERVER_STATE_NAMES = [
  'Running',
  'Failed',
  'NoConfiguration',
  'Suspended',
  'Shutdown',
  'Test',
  'CommunicationFault',
  'Unknown',
];

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function runEndpoints(): Promise<EndpointsArtifact> {
  const config = loadConfig();
  console.log(`[00] Preflight contra ${config.endpointUrl}`);

  const rawEndpoints = await probeEndpoints(config.endpointUrl);
  const endpoints = rawEndpoints.map((e) => ({
    endpointUrl: e.endpointUrl ?? '',
    securityMode: MessageSecurityMode[e.securityMode] ?? String(e.securityMode),
    securityPolicyUri: e.securityPolicyUri ?? '',
    securityLevel: e.securityLevel ?? 0,
    userTokens: (e.userIdentityTokens ?? []).map(
      (t) => `${t.tokenType}:${t.policyId ?? ''}`,
    ),
  }));
  console.log(`[00] ${endpoints.length} endpoint(s) anunciados:`);
  for (const e of endpoints) {
    console.log(`     ${e.endpointUrl} | ${e.securityMode} | ${e.securityPolicyUri}`);
  }

  const externalHost = new URL(config.endpointUrl.replace('opc.tcp://', 'http://')).host;
  const announcedHosts = [
    ...new Set(
      endpoints
        .map((e) => {
          try {
            return new URL(e.endpointUrl.replace('opc.tcp://', 'http://')).host;
          } catch {
            return '';
          }
        })
        .filter(Boolean),
    ),
  ];
  const mismatch = announcedHosts.some((h) => h !== externalHost);
  if (mismatch) {
    console.log(
      `[00] MISMATCH NAT confirmado: servidor anuncia ${announcedHosts.join(', ')}, se accede por ${externalHost}`,
    );
  }

  const conn = await connectReadOnly(config);
  try {
    const namespaces = await conn.session.readNamespaceArray();
    console.log(`[00] namespaces (${namespaces.length}):`);
    namespaces.forEach((uri, i) => console.log(`     ns=${i} → ${uri}`));

    const limitIds = Object.values(LIMIT_NODES);
    const serverIds = Object.values(SERVER_NODES);
    const localBefore = Date.now();
    const dvs = await readInBatches(
      conn.session,
      [...limitIds, ...serverIds].map((nodeId) => ({ nodeId, attributeId: AttributeIds.Value })),
      config.readBatch,
      config.throttleMs,
      'preflight',
    );
    const localAfter = Date.now();

    const limitValues = dvs.slice(0, limitIds.length).map((dv) => numberOrNull(dv.value?.value));
    const serverValues = dvs.slice(limitIds.length);

    const operationLimits = {
      maxNodesPerRead: limitValues[0],
      maxNodesPerBrowse: limitValues[1],
      maxNodesPerTranslate: limitValues[2],
      maxBrowseContinuationPoints: limitValues[3],
      maxArrayLength: limitValues[4],
    };

    const stateRaw = numberOrNull(serverValues[0]?.value?.value);
    const currentTimeRaw = serverValues[1]?.value?.value;
    const currentTime =
      currentTimeRaw instanceof Date && !Number.isNaN(currentTimeRaw.getTime())
        ? currentTimeRaw
        : null;
    const localMid = (localBefore + localAfter) / 2;

    const artifact: EndpointsArtifact = {
      capturedAt: new Date().toISOString(),
      requestedEndpoint: config.endpointUrl,
      endpoints,
      hostnameMismatch: {
        detected: mismatch,
        external: externalHost,
        announcedByServer: announcedHosts,
        workaround: 'OPCUAClient.create({ endpointMustExist: false }) — el socket se mantiene hacia la IP externa',
      },
      sessionEstablished: {
        securityMode: conn.securityMode,
        securityPolicy: conn.securityPolicy,
        identity: conn.identity,
        attempts: conn.attempts,
      },
      namespaces,
      operationLimits,
      effectiveBatches: {
        read: Math.min(
          config.readBatch,
          operationLimits.maxNodesPerRead && operationLimits.maxNodesPerRead > 0
            ? operationLimits.maxNodesPerRead
            : config.readBatch,
        ),
        browse: Math.min(
          config.browseBatch,
          operationLimits.maxNodesPerBrowse && operationLimits.maxNodesPerBrowse > 0
            ? operationLimits.maxNodesPerBrowse
            : config.browseBatch,
        ),
      },
      server: {
        state:
          stateRaw !== null ? (SERVER_STATE_NAMES[stateRaw] ?? String(stateRaw)) : 'Unknown',
        productName: typeof serverValues[2]?.value?.value === 'string' ? (serverValues[2].value.value as string) : null,
        manufacturerName:
          typeof serverValues[3]?.value?.value === 'string' ? (serverValues[3].value.value as string) : null,
        softwareVersion:
          typeof serverValues[4]?.value?.value === 'string' ? (serverValues[4].value.value as string) : null,
        currentTime: currentTime ? currentTime.toISOString() : null,
        clockSkewMs: currentTime ? Math.round(currentTime.getTime() - localMid) : null,
      },
    };

    console.log(
      `[00] servidor: ${artifact.server.productName ?? '?'} (${artifact.server.manufacturerName ?? '?'}) estado=${artifact.server.state} skew=${artifact.server.clockSkewMs}ms`,
    );
    console.log(
      `[00] lotes efectivos → read=${artifact.effectiveBatches.read} browse=${artifact.effectiveBatches.browse}`,
    );
    saveArtifact(config.outputDir, '00_endpoints.json', artifact);
    return artifact;
  } finally {
    await conn.session.close().catch(() => undefined);
    await conn.disconnect();
  }
}

if (require.main === module) {
  runEndpoints().catch((err) => {
    console.error(`\n[00] FALLÓ: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
