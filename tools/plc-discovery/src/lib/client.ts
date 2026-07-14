import * as path from 'path';
import {
  MessageSecurityMode,
  OPCUACertificateManager,
  OPCUAClient,
  SecurityPolicy,
  UserIdentityInfo,
  UserTokenType,
} from 'node-opcua';
import type { EndpointDescription } from 'node-opcua';
import { TOOL_ROOT } from '../config';
import type { AttemptLog, DiscoveryConfig } from '../types';
import { ReadOnlySession } from './readonly-session';

export interface LiveConnection {
  client: OPCUAClient;
  session: ReadOnlySession;
  securityMode: string;
  securityPolicy: string;
  identity: string;
  attempts: AttemptLog[];
  disconnect(): Promise<void>;
}

// Escalera de seguridad: primero lo más simple; solo escalar si el servidor lo exige.
const SECURITY_LADDER: Array<{ mode: MessageSecurityMode; policy: SecurityPolicy }> = [
  { mode: MessageSecurityMode.None, policy: SecurityPolicy.None },
  { mode: MessageSecurityMode.Sign, policy: SecurityPolicy.Basic256Sha256 },
  { mode: MessageSecurityMode.SignAndEncrypt, policy: SecurityPolicy.Basic256Sha256 },
];

let certificateManager: OPCUACertificateManager | null = null;

function getCertificateManager(): OPCUACertificateManager {
  if (!certificateManager) {
    certificateManager = new OPCUACertificateManager({
      rootFolder: path.join(TOOL_ROOT, 'pki'),
      automaticallyAcceptUnknownCertificate: true,
    });
  }
  return certificateManager;
}

function createClient(mode: MessageSecurityMode, policy: SecurityPolicy): OPCUAClient {
  return OPCUAClient.create({
    applicationName: 'ptap-plc-discovery',
    // Workaround NAT canónico: el servidor anuncia 10.10.51.225 pero se accede
    // por la IP pública; sin esto node-opcua rechazaría el endpoint devuelto.
    endpointMustExist: false,
    securityMode: mode,
    securityPolicy: policy,
    // Sin tormentas de reconexión contra un HMI de producción.
    connectionStrategy: { initialDelay: 1000, maxRetry: 2, maxDelay: 5000 },
    requestedSessionTimeout: 120_000,
    keepSessionAlive: true,
    clientCertificateManager: getCertificateManager(),
  });
}

/** Enumera endpoints sin crear sesión (GetEndpoints viaja por canal sin seguridad). */
export async function probeEndpoints(endpointUrl: string): Promise<EndpointDescription[]> {
  const client = createClient(MessageSecurityMode.None, SecurityPolicy.None);
  try {
    await client.connect(endpointUrl);
    return await client.getEndpoints();
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

/**
 * Establece UNA sesión de solo lectura probando la escalera de seguridad
 * (None → Sign → SignAndEncrypt) × (Anonymous → UserName si hay credenciales).
 */
export async function connectReadOnly(config: DiscoveryConfig): Promise<LiveConnection> {
  const identities: Array<{ label: string; token: UserIdentityInfo }> = [
    { label: 'Anonymous', token: { type: UserTokenType.Anonymous } },
  ];
  if (config.username) {
    identities.push({
      label: `UserName(${config.username})`,
      token: {
        type: UserTokenType.UserName,
        userName: config.username,
        password: config.password ?? '',
      },
    });
  }

  const attempts: AttemptLog[] = [];
  for (const sec of SECURITY_LADDER) {
    for (const identity of identities) {
      const client = createClient(sec.mode, sec.policy);
      const modeName = MessageSecurityMode[sec.mode];
      try {
        await client.connect(config.endpointUrl);
        const rawSession = await client.createSession(identity.token);
        console.log(
          `[conexión] sesión establecida: ${modeName}/${sec.policy} + ${identity.label}`,
        );
        return {
          client,
          session: new ReadOnlySession(rawSession),
          securityMode: modeName,
          securityPolicy: String(sec.policy),
          identity: identity.label,
          attempts,
          disconnect: async () => {
            await client.disconnect().catch(() => undefined);
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts.push({
          securityMode: modeName,
          securityPolicy: String(sec.policy),
          identity: identity.label,
          error: message.split('\n')[0],
        });
        console.warn(`[conexión] falló ${modeName}/${sec.policy} + ${identity.label}: ${message.split('\n')[0]}`);
        await client.disconnect().catch(() => undefined);
      }
    }
  }

  const detail = attempts
    .map((a) => `  - ${a.securityMode}/${a.securityPolicy} + ${a.identity}: ${a.error}`)
    .join('\n');
  throw new Error(
    `No fue posible establecer sesión OPC UA con ${config.endpointUrl}.\n` +
      `Intentos:\n${detail}\n` +
      `Si el servidor exige credenciales, definir OPC_USERNAME/OPC_PASSWORD en .env. ` +
      `Si exige seguridad firmada/cifrada, el administrador de Optix debe confiar el certificado generado en pki/.`,
  );
}
