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
import { AiModule } from './modules/ai/ai.module';
import { JwtAuthGuard } from './modules/auth/guards/jwtAuthGuard.guard';
import { Request } from 'express';
import { clientKey } from './infrastructure/security/utils/clientKey';

@Module({
  imports: [
    AuthModule,
    NotesModule,
    AiModule,
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'global', ttl: throttleGlobalConfig.ttl, limit: throttleGlobalConfig.limit },
        { name: 'auth', ttl: throttleAuthConfig.ttl, limit: throttleAuthConfig.limit },
      ],
      // Same client identity as brute force: an IPv6 /64 counts as one client.
      getTracker: (req: Request) => clientKey(req.ip),
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
