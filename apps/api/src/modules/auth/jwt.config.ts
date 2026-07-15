export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export function readJwtConfig(): JwtConfig {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Falta la variable de entorno JWT_SECRET. Defínela en el archivo .env de la raíz del monorepo.');
  }
  return {
    secret,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  };
}
