import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { diaLocal } from '../../infrastructure/connectivity/pipeline/dia-operativo';
import { NotificationRepository } from '../notifications/notification.repository';
import { CommandSignatureService } from './command-signature.service';
import type { EslabonRoto } from './command-signature';

/**
 * Vigila que el libro de firmas de las maniobras siga cuadrando.
 *
 * Existe porque un botón no basta. La cadena de firmas detecta que alguien tocó el histórico, pero
 * solo cuando alguien se acuerda de comprobarla — y nadie comprueba a diario algo que lleva meses
 * saliendo bien. Si el registro es la evidencia que sustituye a la confirmación eléctrica que estas
 * plantas no dan, enterarse de que fue alterado no puede depender de la curiosidad de nadie.
 *
 * Barre cada 6 h. No es un intruso al que haya que pillar en segundos: es una comprobación de
 * integridad sobre un registro que crece unas pocas filas al día.
 *
 * **Un aviso por planta afectada, no uno global.** `notification.plant_id` es `NOT NULL`, pero sobre
 * todo: quien tiene que enterarse de que le retocaron una maniobra es el equipo de esa planta.
 */
@Injectable()
export class SignatureIntegrityDetector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SignatureIntegrity');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sweepMs = Number(process.env.SIGNATURE_SWEEP_MS ?? 6 * 60 * 60_000);

  constructor(
    private readonly firmas: CommandSignatureService,
    private readonly avisos: NotificationRepository,
  ) {}

  onModuleInit(): void {
    // La primera pasada a los 5 min, no en el arranque: durante el arranque la base puede estar
    // todavía levantando y un fallo de conexión se leería como "histórico roto", que es la peor
    // manera posible de equivocarse en esto.
    setTimeout(() => void this.sweep(), 5 * 60_000).unref?.();
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref?.();
    this.logger.log(`integridad del libro de firmas: comprobación cada ${Math.round(this.sweepMs / 3600_000)} h`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Una comprobación. Devuelve cuántos avisos publicó. Público para ejercitarlo en tests. */
  async sweep(): Promise<number> {
    let publicados = 0;
    try {
      const { firmadas, rotos, verificable } = await this.firmas.verificar();
      if (!verificable) {
        // Sin secreto no hay nada que verificar, y no es una anomalía del histórico sino de la
        // configuración: se registra en el log del servidor, no en la bandeja del operario.
        this.logger.warn('sin secreto de firma: no se puede comprobar la integridad del histórico');
        return 0;
      }
      if (rotos.length === 0) {
        this.logger.log(`libro de firmas íntegro: ${firmadas} maniobra(s)`);
        return 0;
      }

      this.logger.error(`LIBRO DE FIRMAS ALTERADO: ${rotos.length} de ${firmadas} maniobras no cuadran`);
      const ahora = new Date();
      for (const [plantId, dePlanta] of agruparPorPlanta(rotos)) {
        const ok = await this.avisos.create({
          kind: 'signature_broken',
          severity: 'critical',
          plantId,
          subject: null,
          title: 'El registro de maniobras fue alterado',
          message: mensaje(dePlanta, firmadas),
          action: 'Avisar a quien administra el sistema y NO borrar nada: el propio rastro es la prueba.',
          day: diaLocal(ahora),
          // Sin `eventId`: la deduplicación por defecto deja un aviso por planta y día. La condición
          // no se arregla sola, y repetirla cada 6 h solo enseñaría a ignorarla.
        });
        if (ok) publicados++;
      }
    } catch (err) {
      this.logger.error(`no se pudo comprobar la integridad: ${err instanceof Error ? err.message : err}`);
    }
    return publicados;
  }
}

function agruparPorPlanta(rotos: EslabonRoto[]): Map<string, EslabonRoto[]> {
  const porPlanta = new Map<string, EslabonRoto[]>();
  for (const r of rotos) {
    const lista = porPlanta.get(r.plantId);
    if (lista) lista.push(r);
    else porPlanta.set(r.plantId, [r]);
  }
  return porPlanta;
}

/**
 * Qué se le cuenta al operario.
 *
 * Se distinguen las dos averías porque significan cosas distintas y llevan a buscar cosas
 * distintas: una fila editada frente a una fila que falta o que se coló en medio.
 */
function mensaje(dePlanta: EslabonRoto[], totalFirmadas: number): string {
  const editadas = dePlanta.filter((r) => r.motivo === 'firma_no_coincide').length;
  const descolocadas = dePlanta.filter((r) => r.motivo === 'eslabon_no_encaja').length;

  const partes: string[] = [];
  if (editadas > 0) {
    partes.push(`${editadas} ${plural(editadas, 'maniobra fue modificada', 'maniobras fueron modificadas')} después de firmarse`);
  }
  if (descolocadas > 0) {
    partes.push(
      `${descolocadas} no ${plural(descolocadas, 'encaja', 'encajan')} con la anterior, que es lo que ocurre cuando se borra o se inserta una fila`,
    );
  }

  const cuando = dePlanta
    .map((r) => r.at)
    .sort()
    .slice(0, 1)[0];
  const desde = cuando ? ` La más antigua es del ${fecha(cuando)}.` : '';

  return `De las ${totalFirmadas} maniobras firmadas del sistema, ${partes.join(' y ')}.${desde} El registro de esta planta ya no se puede dar por bueno sin revisarlo.`;
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}

function fecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
