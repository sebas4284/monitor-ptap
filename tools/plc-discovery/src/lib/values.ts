import { DataType, DataValue, StatusCode, Variant, VariantArrayType } from 'node-opcua';
import type { JsonStatusCode, ValueSample } from '../types';

export function statusCodeToJson(sc: StatusCode | null | undefined): JsonStatusCode {
  if (!sc) return { name: 'Unknown', value: -1, severity: 'Bad' };
  const severityBits = (sc.value >>> 30) & 0x3;
  const severity: JsonStatusCode['severity'] =
    severityBits === 0 ? 'Good' : severityBits === 1 ? 'Uncertain' : 'Bad';
  return { name: sc.name, value: sc.value, severity };
}

/** Sanitiza cualquier valor node-opcua (Variant.value) a JSON plano. */
export function toJsonValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Buffer.isBuffer(v)) return { $base64: v.toString('base64') };
  if (Array.isArray(v)) return v.map(toJsonValue);
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown> & { toJSON?: () => unknown };
    if (typeof obj.toJSON === 'function') {
      try {
        const plain = obj.toJSON();
        if (plain !== v) return toJsonValue(plain);
      } catch {
        // caer al recorrido genérico
      }
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_') || key.startsWith('$')) continue;
      out[key] = toJsonValue(obj[key]);
    }
    return out;
  }
  return String(v);
}

export function variantTypeName(variant: Variant | null | undefined): string | null {
  if (!variant) return null;
  const base = DataType[variant.dataType] ?? String(variant.dataType);
  const arrayType = variant.arrayType;
  if (arrayType === VariantArrayType.Array || arrayType === VariantArrayType.Matrix) {
    return `${base}[]`;
  }
  return base;
}

export function dataValueToSample(dv: DataValue, capturedAt: Date): ValueSample {
  return {
    t: capturedAt.toISOString(),
    value: dv.value ? toJsonValue(dv.value.value) : null,
    statusCode: statusCodeToJson(dv.statusCode),
    sourceTimestamp: dv.sourceTimestamp ? dv.sourceTimestamp.toISOString() : null,
    serverTimestamp: dv.serverTimestamp ? dv.serverTimestamp.toISOString() : null,
  };
}

export function localizedTextToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value || null;
  const obj = value as { text?: unknown };
  if (typeof obj.text === 'string') return obj.text || null;
  return null;
}
