import { Module } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AccessTokenService } from './services/accessToken.service';
import accessTokenConfig from './config/jwt.config';
import refreshJwtConfig from './config/refreshJwt.config';
import { CsrfController } from './controllers/csrf.controller';
import { RefreshTokenService } from './services/refreshToken.serivce';
import { SecurityModule } from 'src/infrastructure/security/security.module';

@Module({
  controllers: [AuthController, CsrfController],
  imports: [
    UsersModule,
    SecurityModule,
    JwtModule.register({ global: true }),
    ConfigModule.forFeature(accessTokenConfig),
    ConfigModule.forFeature(refreshJwtConfig),
  ],
  providers: [RefreshTokenService, AuthService, JwtService, AccessTokenService],
  exports: [AccessTokenService],
})
export class AuthModule {}
