import { Controller, Get, Inject, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { ConnectivityService } from '../../infrastructure/connectivity/connectivity.service';
import { AuditInterceptor } from '../../infrastructure/audit/audit.interceptor';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import { plantIdParamSchema } from '../../infrastructure/validation/plant-id.schema';
import { MinTier } from '../auth/decorators/min-tier.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MinTierGuard } from '../auth/guards/min-tier.guard';

@Controller('snapshots')
@UseGuards(JwtAuthGuard, MinTierGuard)
@UseInterceptors(AuditInterceptor)
@MinTier('viewer')
export class SnapshotsController {
  // @Inject explícito: tsx (esbuild) no emite design:paramtypes, la inyección por tipo falla en dev
  constructor(@Inject(ConnectivityService) private readonly connectivity: ConnectivityService) {}

  @Get(':plantId')
  getSnapshot(@Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string) {
    return this.connectivity.getSnapshot(plantId);
  }
}
