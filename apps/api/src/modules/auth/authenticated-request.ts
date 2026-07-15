import type { Request } from 'express';
import type { AuthUser } from '@ptap/shared';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
