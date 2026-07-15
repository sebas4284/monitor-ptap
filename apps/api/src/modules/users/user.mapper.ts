import type { AuthUser, Role } from '@ptap/shared';
import type { UserRecord } from './users.repository';

export function toAuthUser(record: UserRecord): AuthUser {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role as Role,
    plant: record.plant,
  };
}
