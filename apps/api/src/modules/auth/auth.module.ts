import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { JwtService } from './jwt.service';
import { PasswordHashingService } from './password-hashing.service';

@Module({
  // forwardRef: UsersModule necesita de vuelta los guards de este módulo para su controller.
  imports: [forwardRef(() => UsersModule), AuditModule],
  controllers: [AuthController],
  providers: [PasswordHashingService, JwtService, AuthService, JwtAuthGuard, PermissionGuard],
  exports: [PasswordHashingService, JwtService, JwtAuthGuard, PermissionGuard],
})
export class AuthModule {}
