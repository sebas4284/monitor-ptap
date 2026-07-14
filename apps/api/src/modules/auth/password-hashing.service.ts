import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHmac } from 'node:crypto';

const PEPPER_BYTES = 64;

@Injectable()
export class PasswordHashingService {
  async hashPassword(plainPassword: string): Promise<{ passwordHash: string; pepperVersion: number }> {
    const pepperVersion = this.getCurrentPepperVersion();
    const pepperedPassword = this.applyPepper(plainPassword, pepperVersion);
    const passwordHash = await argon2.hash(pepperedPassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });

    return { passwordHash, pepperVersion };
  }

  async verifyPassword(
    plainPassword: string,
    storedHash: string,
    pepperVersion: number,
  ): Promise<boolean> {
    const pepperedPassword = this.applyPepper(plainPassword, pepperVersion);
    return argon2.verify(storedHash, pepperedPassword);
  }

  private applyPepper(plainPassword: string, pepperVersion: number): Buffer {
    const pepper = this.getPepper(pepperVersion);
    return createHmac('sha256', pepper).update(plainPassword, 'utf8').digest();
  }

  private getCurrentPepperVersion(): number {
    const rawVersion = process.env.PASSWORD_PEPPER_CURRENT_VERSION;
    const version = Number(rawVersion);
    if (!rawVersion || !Number.isInteger(version) || version < 1) {
      throw new Error('PASSWORD_PEPPER_CURRENT_VERSION debe ser un entero positivo.');
    }
    return version;
  }

  private getPepper(version: number): Buffer {
    const envKey = `PASSWORD_PEPPER_V${version}_BASE64`;
    const rawPepper = process.env[envKey];
    if (!rawPepper) {
      throw new Error(`${envKey} no esta definido.`);
    }

    const pepper = Buffer.from(rawPepper, 'base64');
    if (pepper.length !== PEPPER_BYTES) {
      throw new Error(`${envKey} debe decodificar exactamente ${PEPPER_BYTES} bytes.`);
    }

    return pepper;
  }
}
