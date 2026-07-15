import { Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { Role } from '@ptap/shared';
import { readJwtConfig } from './jwt.config';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  plant: string;
}

/** Firma/verifica JWT a mano (jsonwebtoken directo) — sin @nestjs/passport, ver plan Fase 4. */
@Injectable()
export class JwtService {
  private readonly config = readJwtConfig();

  sign(payload: JwtPayload): string {
    return jwt.sign(payload, this.config.secret, { expiresIn: this.config.expiresIn } as jwt.SignOptions);
  }

  verify(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.config.secret) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Token JWT inválido o expirado');
    }
  }
}
