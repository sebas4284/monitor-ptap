import { Module } from '@nestjs/common';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MinTierGuard } from './guards/min-tier.guard';
import { JwtService } from './jwt.service';
import { PasswordHashingService } from './password-hashing.service';

@Module({
  imports: [UsersModule, AuditModule],
  controllers: [AuthController],
  providers: [PasswordHashingService, JwtService, AuthService, JwtAuthGuard, MinTierGuard],
  exports: [PasswordHashingService, JwtService, JwtAuthGuard, MinTierGuard],
})
export class AuthModule {}
