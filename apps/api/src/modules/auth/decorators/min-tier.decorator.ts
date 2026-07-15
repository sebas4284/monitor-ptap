import { SetMetadata } from '@nestjs/common';
import type { RoleTier } from '@ptap/shared';

export const MIN_TIER_KEY = 'minTier';

/** Tier mínimo (viewer < operator < admin) requerido por MinTierGuard para esta ruta. */
export const MinTier = (tier: RoleTier) => SetMetadata(MIN_TIER_KEY, tier);
