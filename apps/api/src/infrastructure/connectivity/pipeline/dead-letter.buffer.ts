export type DeadLetterType = 'INVALID_NUMBER' | 'INDEX_OUT_OF_RANGE' | 'BUFFER_MISSING' | 'UNEXPECTED_LENGTH';

export interface DeadLetterEntry {
  at: string;
  type: DeadLetterType;
  plantId: string;
  domainKey: string;
  detail: string;
}

/**
 * Buffer DeadLetter en RAM (regla 12): nada se descarta en silencio. Toda señal
 * anómala (NaN/Infinity, índice fuera de rango, buffer ausente, longitud inesperada)
 * se registra aquí con tope acotado (ring) y contador por tipo. Consultable por endpoint
 * admin. NO persiste a disco.
 */
export class DeadLetterBuffer {
  private readonly ring: DeadLetterEntry[] = [];
  private readonly counts: Record<DeadLetterType, number> = {
    INVALID_NUMBER: 0,
    INDEX_OUT_OF_RANGE: 0,
    BUFFER_MISSING: 0,
    UNEXPECTED_LENGTH: 0,
  };

  constructor(private readonly capacity = 500) {}

  record(type: DeadLetterType, plantId: string, domainKey: string, detail: string): void {
    this.counts[type]++;
    this.ring.push({ at: new Date().toISOString(), type, plantId, domainKey, detail });
    if (this.ring.length > this.capacity) this.ring.shift();
  }

  snapshot(): { counts: Record<DeadLetterType, number>; total: number; recent: DeadLetterEntry[] } {
    const total = Object.values(this.counts).reduce((a, b) => a + b, 0);
    return { counts: { ...this.counts }, total, recent: [...this.ring] };
  }
}
