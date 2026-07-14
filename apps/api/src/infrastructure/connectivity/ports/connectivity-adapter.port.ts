/**
 * Puerto ConnectivityAdapter — el puente de BUFFERS CRUDOS con el PLC.
 *
 * Contrato único que implementan tanto el simulador como el adaptador OPC UA
 * (regla 5), seleccionados por CONNECTIVITY_PROVIDER. Es PUSH (no polling): las
 * notificaciones llegan por Subscription y se entregan vía onFrame.
 *
 * El adaptador NO conoce la PTAP (regla 3): solo endpoints, NodeIds y buffers.
 * La traducción cruda → dominio ocurre aguas arriba (Mapping Engine, Fase 3).
 */

export type BridgeStatus =
  | 'Connecting'
  | 'Connected'
  | 'Recovering'
  | 'Stale'
  | 'Disconnected'
  | 'Faulted';

export type OpcQuality = 'Good' | 'Bad' | 'Uncertain';

/** Una muestra de un buffer (nodo array completo). Un MonitoredItem por buffer (regla 6). */
export interface RawBufferSample {
  browseName: string;
  channel: string; // realIn | realOut | intIn | intOut | bitIn | bitOut | msgRead | msgWrite
  values: Array<number | boolean>;
  quality: OpcQuality;
  statusCode: string;
  sourceTimestamp: string | null; // del PLC; nunca Date.now() para datos (regla 7)
  serverTimestamp: string | null;
}

/** Notificación cruda por planta. En Fase 1 se emite un buffer por frame. */
export interface RawPlantFrame {
  plantId: string;
  buffers: RawBufferSample[];
  receivedAt: string; // instante de recepción en el backend (metadato de transporte, no de proceso)
}

export interface BufferHealth {
  plantId: string;
  browseName: string;
  channel: string;
  resolved: boolean; // NodeId resuelto contra la sesión viva
  faulted: boolean;
  reason: string | null;
}

export interface PerPlantStatus {
  plantId: string;
  lastFrameAt: string | null;
  buffersTotal: number;
  buffersFaulted: number;
}

export interface AdapterDiagnostics {
  provider: 'simulator' | 'opcua';
  bridgeStatus: BridgeStatus;
  lastNotificationAt: string | null;
  lastNotificationLatencyMs: number | null;
  subscriptionCount: number;
  monitoredItemCount: number;
  reconnectCount: number;
  subscriptionRecycleCount: number;
  notificationsTotal: number;
  buffersActive: number;
  buffersFaulted: number;
  perPlant: PerPlantStatus[];
  recentTransitions: Array<{ at: string; from: BridgeStatus; to: BridgeStatus; reason: string }>;
}

export interface ServerInfo {
  provider: 'simulator' | 'opcua';
  endpoint: string | null;
  activeSecurityMode: string | null;
  activeSecurityPolicy: string | null;
  identity: string | null;
  productName: string | null;
  manufacturerName: string | null;
  softwareVersion: string | null;
  buildNumber: string | null;
  serverState: string | null;
  serverCurrentTime: string | null;
  namespaces: string[];
  sessionId: string | null;
  subscription: {
    publishingIntervalMs: number | null;
    samplingIntervalMs: number | null;
  };
}

/** Firma de la fachada de puente crudo. Push-based; cero polling de datos. */
export interface ConnectivityAdapter {
  readonly provider: 'simulator' | 'opcua';

  /** Conecta + suscribe (opcua) o inicia la emulación (simulador). Idempotente. */
  start(): Promise<void>;
  /** Detiene y libera recursos. Idempotente. */
  stop(): Promise<void>;

  getBridgeStatus(): BridgeStatus;

  onFrame(listener: (frame: RawPlantFrame) => void): void;
  onStatusChange(listener: (status: BridgeStatus, reason: string) => void): void;

  getDiagnostics(): AdapterDiagnostics; // /api/opc/status
  getServerInfo(): Promise<ServerInfo>; // /api/opc/info
  getBufferHealth(): BufferHealth[];
}
