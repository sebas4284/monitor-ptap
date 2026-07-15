import type { LoadedMapping, SignalMapping } from '../mapping/opc-mapping.loader';
import type { OpcQuality, RawBufferSample } from '../ports/connectivity-adapter.port';
import type { DeadLetterBuffer } from './dead-letter.buffer';

export interface ExtractedSignal {
  domainKey: string;
  label: string | null;
  unit: string | null;
  min: number | null;
  max: number | null;
  opMin: number | null;
  opMax: number | null;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: 'confirmed' | 'inferred' | 'estimated';
  value: number | boolean | null; // crudo; puede ser no-finito (lo evalúa QualityService)
  quality: OpcQuality;
  sourceTimestamp: string | null;
  structurallyBroken: boolean; // buffer ausente o índice fuera de rango (ya en dead-letter)
}

/**
 * Mapping Engine (PASO 3.4): traduce buffer+index → domainKey usando opc_mapping.json.
 * Fail-fast al construir si el mapping es inválido. NO conoce la PTAP más allá del mapping.
 *
 * Convención de buffer primario: una señal con `buffer:"realIn"` refiere al buffer realIn
 * PRIMARIO del sitio (REAL_IN_MONTEBELLO, 50 elementos), no a los de tanque (TK1/TK2/TK3,
 * 10 elementos). Se resuelve en runtime como el buffer del canal con más elementos (el
 * primario entrega el array completo del sitio; los de tanque son sub-arrays cortos).
 *
 * Si la señal declara `sourceBuffer` (browseName exacto), ese buffer gana SIEMPRE sobre
 * la heurística de tamaño. Es obligatorio en sitios con varios buffers del mismo canal e
 * igual tamaño (SOLEDAD: REAL_IN_SOLEDAD Float[50] y DATOS_IN_PTAP_SOLEDAD Int16[50]),
 * donde "el de más elementos" empataría y la elección sería no determinista.
 */
export class MappingEngine {
  private readonly signalsByPlant = new Map<string, SignalMapping[]>();

  constructor(mapping: LoadedMapping) {
    for (const s of mapping.signals) {
      const list = this.signalsByPlant.get(s.plantId) ?? [];
      list.push(s);
      this.signalsByPlant.set(s.plantId, list);
    }
  }

  hasSignals(plantId: string): boolean {
    return (this.signalsByPlant.get(plantId)?.length ?? 0) > 0;
  }

  /**
   * Extrae las señales mapeadas de una planta desde el estado ACUMULADO de buffers
   * (browseName → última muestra), no solo del frame entrante (que es coalescido y trae
   * solo los buffers que cambiaron). Registra dead-letters estructurales (regla 12).
   */
  extract(plantId: string, latestBuffers: Map<string, RawBufferSample>, deadLetter: DeadLetterBuffer): ExtractedSignal[] {
    const signals = this.signalsByPlant.get(plantId) ?? [];
    return signals.map((sig) => this.extractOne(sig, latestBuffers, deadLetter));
  }

  private extractOne(sig: SignalMapping, latestBuffers: Map<string, RawBufferSample>, deadLetter: DeadLetterBuffer): ExtractedSignal {
    const base = {
      domainKey: sig.domainKey,
      label: sig.label,
      unit: sig.unit,
      min: sig.min,
      max: sig.max,
      opMin: sig.opMin ?? null,
      opMax: sig.opMax ?? null,
      mappingStatus: sig.mappingStatus,
      confidence: sig.confidence,
    };

    const buffer = sig.sourceBuffer
      ? (latestBuffers.get(sig.sourceBuffer) ?? null)
      : this.primaryBufferOfChannel(sig.buffer, latestBuffers);
    if (!buffer) {
      deadLetter.record(
        'BUFFER_MISSING',
        sig.plantId,
        sig.domainKey,
        sig.sourceBuffer ? `sin buffer ${sig.sourceBuffer} (canal ${sig.buffer})` : `sin buffer del canal ${sig.buffer}`,
      );
      return { ...base, value: null, quality: 'Bad', sourceTimestamp: null, structurallyBroken: true };
    }
    if (sig.index >= buffer.values.length) {
      deadLetter.record(
        'INDEX_OUT_OF_RANGE',
        sig.plantId,
        sig.domainKey,
        `índice ${sig.index} fuera de ${buffer.browseName}[${buffer.values.length}]`,
      );
      return { ...base, value: null, quality: buffer.quality, sourceTimestamp: buffer.sourceTimestamp, structurallyBroken: true };
    }

    const raw = buffer.values[sig.index];
    return {
      ...base,
      value: raw,
      quality: buffer.quality,
      sourceTimestamp: buffer.sourceTimestamp,
      structurallyBroken: false,
    };
  }

  /** Buffer primario del canal = el de más elementos (el array completo del sitio). */
  private primaryBufferOfChannel(channel: string, latestBuffers: Map<string, RawBufferSample>): RawBufferSample | null {
    let best: RawBufferSample | null = null;
    for (const buf of latestBuffers.values()) {
      if (buf.channel !== channel) continue;
      if (!best || buf.values.length > best.values.length) best = buf;
    }
    return best;
  }
}
