import type { DataValue, ReadValueIdOptions } from 'node-opcua';
import { ReadOnlySession } from './readonly-session';
import { sleep } from './throttle';

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const RETRYABLE = /BadTooManyOperations|BadRequestTooLarge|BadTimeout|BadTcpMessageTooLarge/i;

/**
 * Lectura batcheada respetando el límite efectivo del servidor.
 * Ante BadTooManyOperations/BadTimeout el lote se parte a la mitad y se
 * reintenta (una vez por mitad) — nunca se martilla el servidor.
 */
export async function readInBatches(
  session: ReadOnlySession,
  items: ReadValueIdOptions[],
  batchSize: number,
  throttleMs: number,
  label: string,
): Promise<DataValue[]> {
  const out: DataValue[] = [];
  const batches = chunk(items, Math.max(1, batchSize));
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      out.push(...(await session.read(batch)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE.test(message) || batch.length === 1) throw err;
      console.warn(
        `[lectura:${label}] lote de ${batch.length} rechazado (${message.split('\n')[0]}); reintento en mitades`,
      );
      await sleep(throttleMs * 2);
      const half = Math.ceil(batch.length / 2);
      out.push(...(await readInBatches(session, batch.slice(0, half), half, throttleMs, label)));
      out.push(...(await readInBatches(session, batch.slice(half), half, throttleMs, label)));
    }
    if (i < batches.length - 1) await sleep(throttleMs);
    if (batches.length > 10 && (i + 1) % 10 === 0) {
      console.log(`[lectura:${label}] ${i + 1}/${batches.length} lotes`);
    }
  }
  return out;
}
