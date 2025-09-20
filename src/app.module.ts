import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './services/prisma.service';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { throttleGLobalConfig, throttleAuthConfig } from './config/throttle.config';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      { name: 'global', ttl: throttleGLobalConfig.ttl, limit: throttleGLobalConfig.limit },
      { name: 'auth', ttl: throttleAuthConfig.ttl, limit: throttleAuthConfig.limit },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }, PrismaService],
})
export class AppModule {}
