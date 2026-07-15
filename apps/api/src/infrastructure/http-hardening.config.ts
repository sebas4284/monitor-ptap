export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface HttpHardeningConfig {
  corsOrigins: string[] | null;
  rateLimit: RateLimitConfig;
  loginRateLimit: RateLimitConfig;
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
    corsOrigins,
    rateLimit: {
      windowMs: num('RATE_LIMIT_WINDOW_MS', 60000),
      max: num('RATE_LIMIT_MAX', 300),
    },
    loginRateLimit: {
      windowMs: num('LOGIN_RATE_LIMIT_WINDOW_MS', 60000),
      max: num('LOGIN_RATE_LIMIT_MAX', 10),
    },
  };
}
