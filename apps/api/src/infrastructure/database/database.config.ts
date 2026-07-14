export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function readDatabaseConfig(): DatabaseConfig {
  const password = process.env.DB_PASSWORD;
  if (!password) {
    throw new Error(
      'Falta la variable de entorno DB_PASSWORD. Defínela en el archivo .env de la raíz del monorepo.',
    );
  }

  const port = Number.parseInt(process.env.DB_PORT ?? '3306', 10);
  if (Number.isNaN(port)) {
    throw new Error(`DB_PORT no es un número válido: ${process.env.DB_PORT}`);
  }

  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port,
    user: process.env.DB_USER ?? 'root',
    password,
    database: process.env.DB_NAME ?? 'monitor_ptap',
  };
}
