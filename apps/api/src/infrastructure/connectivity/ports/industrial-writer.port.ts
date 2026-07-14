/**
 * @deprecated Camino de datos legado (pre-puente crudo). Se ELIMINA cuando la Fase 3
 * tenga el Mapping Engine. No añadir consumidores nuevos. Ver docs/DEPRECATION.md.
 */
export interface IndustrialWriterPort {
  writeCommand(command: unknown): Promise<void>;
}
