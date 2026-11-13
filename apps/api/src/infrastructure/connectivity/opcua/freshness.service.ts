import { Inject, Injectable } from '@nestjs/common';
import { CONNECTIVITY_ADAPTER } from '../connectivity.tokens';
import type { ConnectivityAdapter } from '../ports/connectivity-adapter.port';
import type { MonitorTarget } from '../mapping/opc-mapping.loader';

export const FRESHNESS_THRESHOLD_MS = 60 * 60_000;
export const INPUT_CHANNELS = new Set(['realIn', 'intIn', 'bitIn']);
export type FreshnessVerdict = 'fresco' | 'congelado' | 'indeterminado' | 'comando';
export interface BufferFreshness {
  browseName: string;
  channel: string;
  sourceTimestamp: string | null;
  statusCode: string;
  ageMs: number | null;
  veredicto: FreshnessVerdict;
}

export function assessFreshness(channel: string, good: boolean, timestamp: string | null, now: number, changed = false): { ageMs: number | null; veredicto: FreshnessVerdict } {
  const source = timestamp === null ? NaN : Date.parse(timestamp);
  const ageMs = Number.isFinite(source) && source <= now ? now - source : null;
  if (!good || ageMs === null) return { ageMs, veredicto: 'indeterminado' };
  if (!INPUT_CHANNELS.has(channel)) return { ageMs, veredicto: 'comando' };
  return { ageMs, veredicto: changed || ageMs <= FRESHNESS_THRESHOLD_MS ? 'fresco' : 'congelado' };
}

@Injectable()
export class FreshnessService {
  constructor(@Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter) {}

  async probe(targets: MonitorTarget[]): Promise<BufferFreshness[]> {
    const result: BufferFreshness[] = [];
    for (const target of targets) {
      let timestamp: string | null = null;
      let statusCode = 'Lectura directa no disponible';
      let good = false;
      try {
        if (this.adapter.readBufferFreshness) {
          const sample = await this.adapter.readBufferFreshness(target.plantId, target.browseName);
          timestamp = sample.sourceTimestamp;
          statusCode = sample.statusCode;
          good = sample.good;
        }
      } catch (error) {
        statusCode = error instanceof Error ? error.message : 'Falló la lectura directa';
      }
      result.push({ browseName: target.browseName, channel: target.channel, sourceTimestamp: timestamp, statusCode, ...assessFreshness(target.channel, good, timestamp, Date.now()) });
    }
    return result;
  }
}
