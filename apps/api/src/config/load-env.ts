import { config } from 'dotenv';
import { resolve } from 'node:path';

// El .env vive en la raíz del monorepo; __dirname es apps/api/{src|dist}/config
// en dev (tsx) y en build, así que la raíz queda siempre 4 niveles arriba.
config({ path: resolve(__dirname, '..', '..', '..', '..', '.env'), quiet: true });
