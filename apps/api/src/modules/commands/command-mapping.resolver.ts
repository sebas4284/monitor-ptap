import { Injectable } from '@nestjs/common';
import {
  loadMapping,
  type BufferElementRef,
  type SignalMapping,
  type WriteSpec,
} from '../../infrastructure/connectivity/mapping/opc-mapping.loader';

export interface ResolvedWritable {
  domainKey: string;
  write: WriteSpec;
}

/**
 * Una válvula cuyos bits de mando NO pueden quedarse puestos sin una orden viva (especificación del
 * integrador del 2026-10-23). La limpieza de huérfanos los apaga al conectar el puente.
 */
export interface MandoALimpiar {
  plantId: string;
  domainKey: string;
  target: BufferElementRef;
  /** OR de las máscaras de sus verbos: lo único que la limpieza puede apagar en esa palabra. */
  bits: number;
  /** `realimentacion`: se acciona con pulse.feedback. `retirado`: writable false con write conservado. */
  origen: 'realimentacion' | 'retirado';
}

/**
 * Resuelve (plantId, target) → señal writable + write spec, desde el mapping (regla 2:
 * toda la semántica vive en el JSON). `target` es el domainKey de la señal writable
 * (identidad única por dominio). Carga el mapping una vez al construir.
 *
 * Es el mapping del REPOSITORIO, sin las correcciones hechas desde la app: lo que se escribe en el
 * PLC sale de aquí. Por eso la limpieza de huérfanos también sale de aquí — apaga los bits que este
 * mismo resolver pudo haber puesto.
 */
@Injectable()
export class CommandMappingResolver {
  private readonly writables: SignalMapping[];
  private readonly paraLimpieza: MandoALimpiar[];

  constructor() {
    const signals = loadMapping().signals;
    this.writables = signals.filter((s) => s.writable && s.write);
    this.paraLimpieza = signals.flatMap((s): MandoALimpiar[] => {
      const fb = s.write?.pulse?.feedback;
      if (s.writable && s.write && fb && s.write.mode === 'bitmask') {
        let bits = 0;
        for (const v of Object.values(s.write.commands)) if (typeof v === 'number') bits |= v & 0xffff;
        return [{ plantId: s.plantId, domainKey: s.domainKey, target: s.write.target, bits, origen: 'realimentacion' }];
      }
      if (!s.writable && s.mandoConservado) {
        const m = s.mandoConservado;
        return [{ plantId: s.plantId, domainKey: s.domainKey, target: m.target, bits: m.bits & 0xffff, origen: 'retirado' }];
      }
      return [];
    });
  }

  resolve(plantId: string, target: string): ResolvedWritable | null {
    const signal = this.writables.find((s) => s.plantId === plantId && s.domainKey === target);
    if (!signal || !signal.write) return null;
    return { domainKey: signal.domainKey, write: signal.write };
  }

  /**
   * Las válvulas que la limpieza de huérfanos vigila: las de pulso con realimentación por bits y las
   * de mando retirado. Las de pulso clásico (300 ms, 45 s) no: su propio `finally` las suelta, y su
   * comportamiento no cambia con la entrega del 2026-10-23.
   */
  mandosParaLimpieza(): MandoALimpiar[] {
    return this.paraLimpieza;
  }
}
