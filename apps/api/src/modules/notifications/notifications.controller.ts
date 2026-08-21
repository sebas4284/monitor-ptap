import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { hasPermission, type NotificationPrefsDto } from '@ptap/shared';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import { NotificationRepository, type NotificationScope, type StoredNotification } from './notification.repository';
import { NotificationPrefsRepository } from './notification-prefs.repository';
import { notificationPrefsSchema } from './notification-prefs.dto';

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
 *
 * **Acotada POR PLANTA.** Aquí no sirve `PlantScopeGuard`: estas rutas no llevan `:plantId`, así
 * que el guard es un no-op y el ámbito hay que aplicarlo en la consulta. Sin eso, un operador de
 * Km 18 recibía —y le sonaban en el celular— los avisos de las otras once plantas.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationRepository) private readonly repo: NotificationRepository,
    @Inject(NotificationPrefsRepository) private readonly prefs: NotificationPrefsRepository,
  ) {}

  /**
   * Identidad y ámbito de quien pregunta.
   *
   * El estado de lectura es POR usuario, así que sin identidad no hay respuesta posible.
   * `JwtAuthGuard` ya lo garantiza; esto es la red de seguridad para que el tipo opcional no
   * degenere en un `!` que oculte un fallo de wiring de guards.
   *
   * `plantScope: null` significa TODAS las plantas y solo lo concede `view_all_plants` (hoy el
   * Admin). Para el resto es la planta de la cuenta — y si esa cuenta no trae planta, esto
   * FALLA en vez de caer a `null`: un fallo de wiring debe cerrar la bandeja, no abrirla entera.
   */
  private scopeOf(req: AuthenticatedRequest): { userId: string; plantScope: string | null } {
    const user = req.user;
    if (!user?.id) throw new UnauthorizedException('Sesión requerida');
    if (hasPermission(user.role, 'view_all_plants')) return { userId: user.id, plantScope: null };
    if (!user.plant) throw new ForbiddenException('Tu cuenta no tiene una planta asignada');
    return { userId: user.id, plantScope: user.plant };
  }

  /**
   * Ámbito completo: planta + lo que esa persona ha elegido recibir.
   *
   * Lo resuelven los tres endpoints por igual, y por eso la campana, la bandeja y lo que marca
   * "visto" no pueden discrepar: es literalmente el mismo `WHERE`.
   */
  private async ambito(req: AuthenticatedRequest, includeMuted: boolean): Promise<{ userId: string; scope: NotificationScope }> {
    const { userId, plantScope } = this.scopeOf(req);
    const prefs = await this.prefs.get(userId);
    return {
      userId,
      scope: { plantScope, mutedKinds: prefs.mutedKinds, minSeverity: prefs.minSeverity, includeMuted },
    };
  }

  /** Historial reciente de SU planta, con el estado de visto DE QUIEN pregunta. */
  @Get()
  @RequirePermission('view_dashboard')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('incluirSilenciados') incluirSilenciados?: string,
  ): Promise<{ notifications: StoredNotification[]; unseen: number }> {
    const { userId, scope } = await this.ambito(req, incluirSilenciados === '1');
    const [notifications, unseen] = await Promise.all([
      this.repo.listRecent(userId, scope, HISTORY_HOURS, MAX_ITEMS),
      // El contador NUNCA cuenta lo silenciado, aunque se esté mirando: la campana refleja lo que
      // el usuario pidió que le reclamara la atención, no lo que está husmeando ahora mismo.
      this.repo.countUnseen(userId, { ...scope, includeMuted: false }, HISTORY_HOURS),
    ]);
    return { notifications, unseen };
  }

  /** Solo el contador: es lo que sondea la campana, y así no se baja el historial entero. */
  @Get('unseen-count')
  @RequirePermission('view_dashboard')
  async unseenCount(@Req() req: AuthenticatedRequest): Promise<{ unseen: number }> {
    const { userId, scope } = await this.ambito(req, false);
    return { unseen: await this.repo.countUnseen(userId, scope, HISTORY_HOURS) };
  }

  /**
   * Marca como vistos todos los avisos del historial. Lo llama el front al ABRIR la bandeja:
   * "visto" significa que la persona entró a mirarlos, que es exactamente lo que se pidió.
   */
  @Post('seen')
  @RequirePermission('view_dashboard')
  async markSeen(
    @Req() req: AuthenticatedRequest,
    @Query('incluirSilenciados') incluirSilenciados?: string,
  ): Promise<{ marked: number }> {
    const { userId, scope } = await this.ambito(req, incluirSilenciados === '1');
    return { marked: await this.repo.markAllSeen(userId, scope, HISTORY_HOURS) };
  }

  /** Qué avisos quiere recibir. Sin nada guardado devuelve el default: todo. */
  @Get('preferences')
  @RequirePermission('view_dashboard')
  async getPreferences(@Req() req: AuthenticatedRequest): Promise<NotificationPrefsDto> {
    const { userId } = this.scopeOf(req);
    return this.prefs.get(userId);
  }

  /**
   * Guarda las preferencias de QUIEN pide, y solo de quien pide: el `userId` sale del token, nunca
   * del cuerpo. Nadie puede callarle los avisos a otra persona.
   */
  @Put('preferences')
  @RequirePermission('view_dashboard')
  async putPreferences(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(notificationPrefsSchema)) body: NotificationPrefsDto,
  ): Promise<NotificationPrefsDto> {
    const { userId } = this.scopeOf(req);
    await this.prefs.save(userId, body);
    return body;
  }
}
