import { ConflictException, Injectable } from '@nestjs/common';

/** Edición y exportación comparten la misma exclusión para no publicar una corrección revertida. */
@Injectable()
export class MappingWriteLock {
  private busy = false;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ConflictException({ motivo: 'MAPPING_OCUPADO', message: 'Hay otra edición o exportación del mapeo en curso. Vuelve a intentarlo.' });
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
}
