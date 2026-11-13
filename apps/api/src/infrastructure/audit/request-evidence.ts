import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, Response } from 'express';

export interface RequestEvidence {
  requestId: string;
  peerIp: string | null;
  /** Dato declarado por el cliente; no identifica de forma fiable un dispositivo. */
  userAgent: string | null;
}

export function requestEvidence(req: Request, res: Response): RequestEvidence {
  // Nunca aceptar el identificador enviado por el cliente como identidad de auditoría.
  const requestId: string = res.locals.auditRequestId ??= randomUUID();
  res.setHeader('X-Request-ID', requestId);
  const peer = req.socket?.remoteAddress;
  return {
    requestId,
    peerIp: peer && isIP(peer) ? peer : null,
    userAgent: req.get('user-agent')?.slice(0, 512).replace(/[\u0000-\u001f\u007f]/g, '') || null,
  };
}
