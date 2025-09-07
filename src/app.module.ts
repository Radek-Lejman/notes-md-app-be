import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './services/prisma.service';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { throttleGLobalConfig } from './common/utils/throttle.config';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([throttleGLobalConfig]),
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
