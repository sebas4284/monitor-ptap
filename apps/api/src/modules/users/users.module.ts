import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * forwardRef con AuthModule: AuthModule importa UsersModule (para UsersRepository) y
 * UsersModule necesita de vuelta los guards de AuthModule (JwtAuthGuard/PermissionGuard)
 * para su controller. Es una circularidad legítima entre módulos, resuelta con forwardRef.
 */
@Module({
  imports: [DatabaseModule, AuditModule, forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersRepository],
})
export class UsersModule {}
