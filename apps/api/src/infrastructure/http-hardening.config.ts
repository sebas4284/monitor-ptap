import { isIP } from 'node:net';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface HttpHardeningConfig {
  trustedProxies: string[] | false;
  corsOrigins: string[] | null;
  rateLimit: RateLimitConfig;
  loginRateLimit: RateLimitConfig;
  commandRateLimit: RateLimitConfig;
}

/** Solo direcciones explícitas; contar saltos permite falsificar la IP si existe un acceso directo. */
export function readTrustedProxies(raw = process.env.TRUSTED_PROXY_CIDRS): string[] | false {
  if (!raw?.trim()) return false;
  const entries = raw.split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const family = isIP(address);
    const max = family === 4 ? 32 : 128;
    if (!family || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > max))) {
      throw new Error('TRUSTED_PROXY_CIDRS debe contener IPs o CIDRs explícitos, sin redes /0');
    }
  }
  return entries;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readHttpHardeningConfig(): HttpHardeningConfig {
  const rawOrigins = process.env.CORS_ORIGINS;
  const corsOrigins = rawOrigins
    ? rawOrigins.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  return {
    trustedProxies: readTrustedProxies(),
    corsOrigins,
    rateLimit: {
      windowMs: num('RATE_LIMIT_WINDOW_MS', 60000),
      max: num('RATE_LIMIT_MAX', 300),
    },
    loginRateLimit: {
      windowMs: num('LOGIN_RATE_LIMIT_WINDOW_MS', 60000),
      max: num('LOGIN_RATE_LIMIT_MAX', 10),
    },
    commandRateLimit: {
      windowMs: num('COMMAND_RATE_LIMIT_WINDOW_MS', 60000),
      max: num('COMMAND_RATE_LIMIT_MAX', 60),
    },
  };
}
