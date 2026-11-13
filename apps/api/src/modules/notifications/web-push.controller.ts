import { Body, Controller, ForbiddenException, Get, Inject, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { hasPermission, type PruebaPushDto } from '@ptap/shared';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { WebPushDispatcher } from './web-push.dispatcher';
import { webPushIdentitySchema, webPushSubscriptionSchema, type WebPushIdentity, type WebPushSubscription } from './web-push.dto';
import { WebPushRepository } from './web-push.repository';

@Controller('notifications/web-push')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WebPushController {
  constructor(@Inject(WebPushRepository) private readonly subscriptions: WebPushRepository,
    @Inject(WebPushDispatcher) private readonly push: WebPushDispatcher) {}

  private scope(req: AuthenticatedRequest): { userId: string; plant: string } {
    const user = req.user;
    if (!user?.id) throw new UnauthorizedException('Sesión requerida');
    if (!hasPermission(user.role, 'view_dashboard') || (!user.plant && !hasPermission(user.role, 'view_all_plants'))) {
      throw new ForbiddenException('Cuenta sin ámbito de notificaciones');
    }
    return { userId: user.id, plant: user.plant ?? '' };
  }
  @Get('config')
  @RequirePermission('view_dashboard')
  config(@Req() req: AuthenticatedRequest): { pushActivo: boolean; publicKey: string | null } {
    this.scope(req);
    return { pushActivo: this.push.active, publicKey: this.push.publicKey };
  }
  @Post('subscriptions')
  @RequirePermission('view_dashboard')
  async register(@Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(webPushSubscriptionSchema)) body: WebPushSubscription): Promise<{ pushActivo: boolean; binding: string }> {
    await this.subscriptions.register(this.scope(req).userId, body);
    return { pushActivo: this.push.active, binding: body.binding };
  }
  @Post('subscriptions/remove')
  @RequirePermission('view_dashboard')
  async remove(@Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(webPushIdentitySchema)) body: WebPushIdentity): Promise<{ quitado: boolean }> {
    return { quitado: (await this.subscriptions.remove(this.scope(req).userId, body)) > 0 };
  }
  @Post('test')
  @RequirePermission('view_dashboard')
  async test(@Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(webPushIdentitySchema)) body: WebPushIdentity): Promise<PruebaPushDto> {
    const { userId, plant } = this.scope(req);
    return this.push.sendTest(userId, plant, body);
  }
}
