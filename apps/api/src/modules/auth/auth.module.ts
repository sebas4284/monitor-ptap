import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { EmailModule } from '../email/email.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationRepository } from './email-verification.repository';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { PlantScopeGuard } from './guards/plant-scope.guard';
import { JwtService } from './jwt.service';
import { PasswordHashingService } from './password-hashing.service';

@Module({
  // forwardRef: UsersModule necesita de vuelta los guards de este módulo para su controller.
  imports: [forwardRef(() => UsersModule), AuditModule, EmailModule, DatabaseModule],
  controllers: [AuthController],
  providers: [
    PasswordHashingService,
    JwtService,
    AuthService,
    EmailVerificationRepository,
    JwtAuthGuard,
    PermissionGuard,
    PlantScopeGuard,
  ],
  // Se reexporta UsersModule a propósito: Nest instancia los guards referenciados por clase en
  // `@UseGuards()` dentro del módulo del CONTROLLER, y allí resuelve sus dependencias. Como
  // JwtAuthGuard ahora necesita UsersRepository (relee al usuario en cada petición), cualquier
  // módulo que importe AuthModule para usar el guard debe recibir también con qué construirlo;
  // si no, Nest revienta en el arranque con "can't resolve dependencies of the JwtAuthGuard".
  exports: [
    PasswordHashingService,
    JwtService,
    JwtAuthGuard,
    PermissionGuard,
    PlantScopeGuard,
    forwardRef(() => UsersModule),
  ],
})
export class AuthModule {}
