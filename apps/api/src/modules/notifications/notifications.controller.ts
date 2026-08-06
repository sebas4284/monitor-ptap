import { Controller, Get, Inject, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { NotificationRepository, type StoredNotification } from './notification.repository';

/** Ventana del historial. El requisito es "mínimo 24 h"; se sirven 72 para cubrir un fin de semana. */
const HISTORY_HOURS = 72;
const MAX_ITEMS = 200;

/**
 * Bandeja de notificaciones.
 *
 * **No hay endpoint de borrado, y es deliberado.** El usuario no puede eliminar un aviso: solo
 * marcarlo como visto. El historial es evidencia operativa — si alguien pudiera borrar el aviso de
 * que un sensor lleva 15 días caído, se perdería justo el rastro que hace falta para reclamarlo.
 *
 * Exige `view_dashboard`: el Civil no recibe avisos de proceso (coherente con el resto de la
 * matriz, que no le da señales detalladas).
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class NotificationsController {
  constructor(@Inject(NotificationRepository) private readonly repo: NotificationRepository) {}

  /**
   * El estado de lectura es POR usuario, así que sin identidad no hay respuesta posible.
   * `JwtAuthGuard` ya lo garantiza; esto es la red de seguridad para que el tipo opcional no
   * degenere en un `!` que oculte un fallo de wiring de guards.
   */
  private userIdOf(req: AuthenticatedRequest): string {
    const id = req.user?.id;
    if (!id) throw new UnauthorizedException('Sesión requerida');
    return id;
  }

  /** Historial reciente, con el estado de visto DE QUIEN pregunta. */
  @Get()
  @RequirePermission('view_dashboard')
  async list(@Req() req: AuthenticatedRequest): Promise<{ notifications: StoredNotification[]; unseen: number }> {
    const userId = this.userIdOf(req);
    const [notifications, unseen] = await Promise.all([
      this.repo.listRecent(userId, HISTORY_HOURS, MAX_ITEMS),
      this.repo.countUnseen(userId, HISTORY_HOURS),
    ]);
    return { notifications, unseen };
  }

  /** Solo el contador: es lo que sondea la campana, y así no se baja el historial entero. */
  @Get('unseen-count')
  @RequirePermission('view_dashboard')
  async unseenCount(@Req() req: AuthenticatedRequest): Promise<{ unseen: number }> {
    return { unseen: await this.repo.countUnseen(this.userIdOf(req), HISTORY_HOURS) };
  }

  /**
   * Marca como vistos todos los avisos del historial. Lo llama el front al ABRIR la bandeja:
   * "visto" significa que la persona entró a mirarlos, que es exactamente lo que se pidió.
   */
  @Post('seen')
  @RequirePermission('view_dashboard')
  async markSeen(@Req() req: AuthenticatedRequest): Promise<{ marked: number }> {
    return { marked: await this.repo.markAllSeen(this.userIdOf(req), HISTORY_HOURS) };
  }
}
