import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { UsersRepository } from './users.repository';

@Module({
  imports: [DatabaseModule],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
