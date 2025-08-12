import { Module } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma.service';
import { UsersService } from './users.service';

@Module({
  controllers: [],
  providers: [UsersService, PrismaService],
  exports: [UsersService],
})
export class UsersModule {}
