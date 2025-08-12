import { Module } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { PrismaService } from 'src/services/prisma.service';
import { UsersModule } from '../users/users.module';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { JwtInnerService } from './services/jwt.service';
import accessTokenConfig from './config/jwt.config';
import refreshJwtConfig from './config/refreshJwt.config';

@Module({
  controllers: [AuthController],
  imports: [
    UsersModule,
    JwtModule.register({ global: true }),
    ConfigModule.forFeature(accessTokenConfig),
    ConfigModule.forFeature(refreshJwtConfig),
  ],
  providers: [AuthService, PrismaService, JwtService, JwtInnerService],
  exports: [],
})
export class AuthModule {}
