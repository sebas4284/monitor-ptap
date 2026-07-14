/**
 * Configuración del módulo de conectividad. TODO sale de .env (regla 8); cero
 * valores quemados en el resto del código. Aquí se centralizan los defaults.
 */

export type ConnectivityProvider = 'simulator' | 'opcua';

export interface OpcIdentityAnonymous {
  type: 'anonymous';
}
export interface OpcIdentityUserName {
  type: 'username';
  userName: string;
  password: string;
}
export type OpcIdentity = OpcIdentityAnonymous | OpcIdentityUserName;

export interface OpcUaConfig {
  endpoint: string;
  endpointMustExist: boolean;
  securityMode: string; // None | Sign | SignAndEncrypt
  securityPolicy: string; // None | Basic256Sha256 | Aes128_Sha256_RsaOaep | Aes256_Sha256_RsaPss
  identity: OpcIdentity;
  publishingIntervalMs: number;
  samplingIntervalMs: number;
  watchdogTimeoutMs: number;
  heartbeatIntervalMs: number;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  reconnectMaxRetry: number;
  subscriptionRecycleMaxAttempts: number;
  staleThresholdMs: number;
  writesEnabled: boolean; // OPCUA_WRITES_ENABLED (Fase 5); aquí solo se lee, nunca habilita write en Fase 1
}

export interface ConnectivityConfig {
  provider: ConnectivityProvider;
  opcua: OpcUaConfig;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Variable de entorno ${name} inválida: "${raw}" (se esperaba número ≥ 0)`);
  }
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function resolveIdentity(): OpcIdentity {
  const kind = str('OPC_IDENTITY', 'anonymous').toLowerCase();
  if (kind === 'username') {
    const userName = process.env.OPC_USERNAME ?? '';
    const password = process.env.OPC_PASSWORD ?? '';
    if (!userName) throw new Error('OPC_IDENTITY=username requiere OPC_USERNAME');
    return { type: 'username', userName, password };
  }
  return { type: 'anonymous' };
}

export function loadConnectivityConfig(): ConnectivityConfig {
  const provider = str('CONNECTIVITY_PROVIDER', 'opcua').toLowerCase();
  if (provider !== 'simulator' && provider !== 'opcua') {
    throw new Error(`CONNECTIVITY_PROVIDER inválido: "${provider}" (simulator | opcua)`);
  }

  return {
    provider,
    opcua: {
      // El servidor se anuncia con IP interna 10.10.51.225 → endpointMustExist:false.
      endpoint: str('OPC_ENDPOINT', 'opc.tcp://181.204.165.66:59100'),
      endpointMustExist: bool('OPC_ENDPOINT_MUST_EXIST', false),
      securityMode: str('OPC_SECURITY_MODE', 'None'),
      securityPolicy: str('OPC_SECURITY_POLICY', 'None'),
      identity: resolveIdentity(),
      publishingIntervalMs: num('OPCUA_PUBLISHING_INTERVAL_MS', 2000),
      samplingIntervalMs: num('OPCUA_SAMPLING_INTERVAL_MS', 1000),
      watchdogTimeoutMs: num('OPCUA_WATCHDOG_TIMEOUT_MS', 30000),
      heartbeatIntervalMs: num('OPCUA_HEARTBEAT_INTERVAL_MS', 10000),
      reconnectInitialDelayMs: num('OPCUA_RECONNECT_INITIAL_DELAY_MS', 1000),
      reconnectMaxDelayMs: num('OPCUA_RECONNECT_MAX_DELAY_MS', 30000),
      reconnectMaxRetry: num('OPCUA_RECONNECT_MAX_RETRY', 1_000_000), // efectivamente indefinido; el operador restaura la red sin reiniciar
      subscriptionRecycleMaxAttempts: num('OPCUA_SUBSCRIPTION_RECYCLE_MAX_ATTEMPTS', 3),
      staleThresholdMs: num('OPCUA_STALE_THRESHOLD_MS', 300000), // 5 min (FASE 0.3: frescura de datos)
      writesEnabled: bool('OPCUA_WRITES_ENABLED', false),
    },
  };
}
