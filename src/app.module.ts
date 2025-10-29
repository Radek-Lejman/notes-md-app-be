import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  throttleGlobalConfig,
  throttleAuthConfig,
} from './infrastructure/security/config/throttle.config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './infrastructure/database/prisma/prisma.module';
import { NotesModule } from './modules/notes/notes.module';
import { JwtAuthGuard } from './modules/auth/guards/jwtAuthGuard.guard';

@Module({
  imports: [
    AuthModule,
    NotesModule,
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      { name: 'global', ttl: throttleGlobalConfig.ttl, limit: throttleGlobalConfig.limit },
      { name: 'auth', ttl: throttleAuthConfig.ttl, limit: throttleAuthConfig.limit },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
