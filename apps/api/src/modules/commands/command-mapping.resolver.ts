import { Injectable } from '@nestjs/common';
import { loadMapping, type SignalMapping, type WriteSpec } from '../../infrastructure/connectivity/mapping/opc-mapping.loader';

export interface ResolvedWritable {
  domainKey: string;
  write: WriteSpec;
}

/**
 * Resuelve (plantId, target) → señal writable + write spec, desde el mapping (regla 2:
 * toda la semántica vive en el JSON). `target` es el domainKey de la señal writable
 * (identidad única por dominio). Carga el mapping una vez al construir.
 *
 * En PRODUCCIÓN hoy NO hay señales writable (sin L5X): resolve() devuelve null para todo,
 * y el WriteService rechaza con TARGET_NOT_WRITABLE — seguro por defecto.
 */
@Injectable()
export class CommandMappingResolver {
  private readonly writables: SignalMapping[];

  constructor() {
    this.writables = loadMapping().signals.filter((s) => s.writable && s.write);
  }

  resolve(plantId: string, target: string): ResolvedWritable | null {
    const signal = this.writables.find((s) => s.plantId === plantId && s.domainKey === target);
    if (!signal || !signal.write) return null;
    return { domainKey: signal.domainKey, write: signal.write };
  }
}
