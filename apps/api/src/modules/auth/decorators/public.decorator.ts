import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca una ruta como exenta de JwtAuthGuard (p. ej. POST /api/auth/login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
