export interface IndustrialWriterPort {
  writeCommand(command: unknown): Promise<void>;
}
