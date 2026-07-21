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

/**
 * Notificación cruda por planta: UN frame por planta por ventana de coalescing,
 * con TODOS los buffers que cambiaron en esa ventana (nunca un frame por buffer).
 * Sin `sequence` hasta Fase 2 (lo añade el parser, no el adaptador).
 */
export interface RawPlantFrame {
  plantId: string;
  buffers: RawBufferSample[];
  receivedAt: string; // instante de emisión del frame en el backend (metadato de transporte, no de proceso)
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
  /** Raw samples superseded por otro dentro de la misma ventana de coalescing (FrameCoalescer). */
  droppedNotificationsTotal: number;
  /** Último probe de heartbeat (exitoso o no). null si nunca corrió. */
  lastHeartbeatAt: string | null;
  lastSuccessfulHeartbeatAt: string | null;
  /** Fallos de heartbeat CONSECUTIVOS actuales (se resetea con un probe OK). */
  heartbeatFailures: number;
  /** Fallos de heartbeat acumulados desde start(). */
  heartbeatFailuresTotal: number;
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

/** Fase 5: elemento de un buffer a escribir/leer. El adaptador lo resuelve a NodeId + IndexRange. */
export interface BufferElementTarget {
  plantId: string;
  channel: string; // canal de salida (realOut | intOut | bitOut | msgWrite) para write; cualquiera para read-back
  sourceBuffer: string; // browseName exacto del buffer
  index: number;
}

/**
 * Fase 5: contexto de seguridad de la sesión, para la PRECONDICIÓN DURA de escritura.
 * `secure` = sesión autenticada Y cifrada (SignAndEncrypt + identidad no anónima). El
 * WriteService rechaza toda escritura si !secure, sin excepciones.
 */
export interface WriteSecurity {
  secure: boolean;
  securityMode: string;
  identity: string;
}

export interface BufferElementRead {
  value: number | boolean | null;
  quality: OpcQuality;
  sourceTimestamp: string | null;
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

  // ── Fase 5: canal de escritura (SOLO alcanzable tras la precondición dura del WriteService) ──
  /** Contexto de seguridad de la sesión (autenticada + cifrada). */
  getWriteSecurity(): WriteSecurity;
  /** Escribe UN elemento de un buffer de salida. No valida seguridad/interlock: eso es del WriteService. */
  writeBufferElement(target: BufferElementTarget, value: number | boolean): Promise<void>;
  /** Lee UN elemento (read-back de confirmación). */
  readBufferElement(target: BufferElementTarget): Promise<BufferElementRead>;
}
