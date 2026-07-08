import type { ConnectionStatus } from '@ptap/shared';

export interface ProtocolAdapterPort {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ConnectionStatus;
}
