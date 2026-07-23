import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { JsonLogger } from '../../infrastructure/logging/json-logger.service';

/**
 * Envío de correo con transporte PLUGGABLE (regla del prompt maestro: config desde .env).
 *
 *   EMAIL_TRANSPORT=console (default) → NO envía nada real: escribe el enlace al log. Sirve para
 *     desarrollo/pruebas sin proveedor (el registro imprime el enlace de verificación y se abre a
 *     mano).
 *   EMAIL_TRANSPORT=smtp → envío REAL vía nodemailer con SMTP_* (host/port/user/pass/secure).
 *     El transporter se crea de forma perezosa la primera vez. Si faltan credenciales, cae a
 *     `console` con un aviso (no rompe el registro).
 *
 * DB-free a propósito: no depende de MySQL.
 */
@Injectable()
export class EmailService {
  private transporter: Transporter | null = null;

  constructor(@Inject(JsonLogger) private readonly logger: JsonLogger) {}

  private get transport(): string {
    return process.env.EMAIL_TRANSPORT ?? 'console';
  }

  private get from(): string {
    return process.env.EMAIL_FROM ?? 'Monitor PTAP <no-reply@monitor-ptap.local>';
  }

  /** Crea (una vez) el transporter SMTP desde SMTP_*. Devuelve null si falta config. */
  private smtpTransporter(): Transporter | null {
    if (this.transporter) return this.transporter;
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) return null;
    this.transporter = createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true', // true = 465/TLS directo; false = 587/STARTTLS
      auth: { user, pass },
    });
    return this.transporter;
  }

  /** Correo de verificación de cuenta. `link` es la URL absoluta que el usuario debe abrir. */
  async sendVerificationEmail(to: string, link: string): Promise<void> {
    const subject = 'Verifica tu cuenta — Monitor PTAP';
    const text =
      `Hola,\n\nConfirma tu correo para completar el registro en Monitor PTAP abriendo este enlace:\n` +
      `${link}\n\nEl enlace vence pronto. Si no creaste esta cuenta, ignora este mensaje.`;
    const html =
      `<p>Hola,</p><p>Confirma tu correo para completar el registro en Monitor PTAP:</p>` +
      `<p><a href="${link}">Verificar mi cuenta</a></p>` +
      `<p style="color:#6b7280;font-size:12px">El enlace vence pronto. Si no creaste esta cuenta, ignora este mensaje.</p>`;

    if (this.transport === 'smtp') {
      const tx = this.smtpTransporter();
      if (tx) {
        await tx.sendMail({ from: this.from, to, subject, text, html });
        this.logger.log({ msg: 'email.verification enviado por SMTP', to, subject });
        return;
      }
      this.logger.warn({ msg: 'EMAIL_TRANSPORT=smtp pero faltan SMTP_HOST/USER/PASS; usando console', to });
    }

    // Transporte console (y fallback): el enlace queda en el log para abrirlo a mano en dev.
    this.logger.log({
      msg: 'email.verification (transporte console: NO enviado, solo registrado)',
      from: this.from,
      to,
      subject,
      link,
      body: text,
    });
  }
}
