import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../infrastructure/logging/json-logger.service';

/**
 * Envío de correo con transporte PLUGGABLE (regla del prompt maestro: config desde .env).
 *
 *   EMAIL_TRANSPORT=console (default) → NO envía nada real: escribe el enlace al log. Sirve para
 *     desarrollo/pruebas sin proveedor (el registro imprime el enlace de verificación y se abre a
 *     mano). Es el modo actual del proyecto (backend self-hosted, sin infra de correo todavía).
 *   EMAIL_TRANSPORT=smtp → envío real vía nodemailer con SMTP_* (documentado en .env.example).
 *     Deliberadamente NO implementado aquí todavía: activarlo es añadir nodemailer y leer SMTP_*;
 *     hasta entonces, pedir 'smtp' sin implementación cae a 'console' con un aviso, para no romper.
 *
 * DB-free a propósito: no depende de MySQL.
 */
@Injectable()
export class EmailService {
  constructor(@Inject(JsonLogger) private readonly logger: JsonLogger) {}

  private get transport(): string {
    return process.env.EMAIL_TRANSPORT ?? 'console';
  }

  private get from(): string {
    return process.env.EMAIL_FROM ?? 'Monitor PTAP <no-reply@monitor-ptap.local>';
  }

  /** Correo de verificación de cuenta. `link` es la URL absoluta que el usuario debe abrir. */
  async sendVerificationEmail(to: string, link: string): Promise<void> {
    const subject = 'Verifica tu cuenta — Monitor PTAP';
    const body =
      `Hola,\n\nConfirma tu correo para completar el registro en Monitor PTAP abriendo este enlace:\n` +
      `${link}\n\nEl enlace vence pronto. Si no creaste esta cuenta, ignora este mensaje.`;

    if (this.transport === 'smtp') {
      // Cuando se implemente: crear el transport de nodemailer con SMTP_* y enviar aquí.
      this.logger.warn({
        msg: 'EMAIL_TRANSPORT=smtp aún no implementado; usando transporte console',
        to,
      });
    }

    // Transporte console (y fallback): el enlace queda en el log para abrirlo a mano en dev.
    this.logger.log({
      msg: 'email.verification (transporte console: NO enviado, solo registrado)',
      from: this.from,
      to,
      subject,
      link,
      body,
    });
  }
}
