import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !(value instanceof Error);
}

/**
 * LoggerService de Nest respaldado por pino (Fase 4: logging JSON). Instalado vía
 * app.useLogger() en main.ts — TODOS los Logger.log()/warn()/error() existentes
 * (infrastructure/connectivity/**) empiezan a salir en JSON sin tocar esos archivos:
 * si message es string, se emite { level, msg, context }; si es un objeto plano
 * (el camino que usan structured-events.subscriber.ts para plantId/bridgeStatus/
 * sequence), se spreadea directo en la línea JSON.
 */
@Injectable()
export class JsonLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }
  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }
  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', message, optionalParams);
  }

  private write(level: pino.Level, message: unknown, optionalParams: unknown[]): void {
    const context = typeof optionalParams[optionalParams.length - 1] === 'string' ? optionalParams[optionalParams.length - 1] : undefined;

    if (isPlainObject(message)) {
      logger[level]({ ...message, context });
      return;
    }
    if (message instanceof Error) {
      logger[level]({ context, err: { name: message.name, message: message.message, stack: message.stack } });
      return;
    }
    logger[level]({ context }, String(message));
  }
}
