import { Module } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { PrismaService } from 'src/services/prisma.service';
import { UsersModule } from '../users/users.module';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AccessTokenService } from './services/accessToken.service';
import accessTokenConfig from './config/jwt.config';
import refreshJwtConfig from './config/refreshJwt.config';
import { CsrfController } from './controllers/csrf.controller';
import { BruteForceService } from 'src/services/bruteForceService';
import { RefreshTokenService } from './services/refreshToken.serivce';

@Module({
  controllers: [AuthController, CsrfController],
  imports: [
    UsersModule,
    JwtModule.register({ global: true }),
    ConfigModule.forFeature(accessTokenConfig),
    ConfigModule.forFeature(refreshJwtConfig),
  ],
  providers: [
    RefreshTokenService,
    AuthService,
    BruteForceService,
    PrismaService,
    JwtService,
    AccessTokenService,
  ],
  exports: [AccessTokenService],
})
export class AuthModule {}
