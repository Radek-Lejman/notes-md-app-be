import { Injectable, ConflictException, UnauthorizedException, Logger } from '@nestjs/common';
import { Request as ReqExpress } from 'express';
import { RegisterDto } from '../dto/register.dto';
import * as bcrypt from 'bcryptjs';
import { UsersService } from 'src/modules/users/users.service';
import { AccessTokenService } from './accessToken.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenService } from './refreshToken.serivce';
import { User } from 'src/modules/users/interfaces/user.interface';
import { BruteForceService } from 'src/infrastructure/security/services/bruteForceService';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly bruteForceService: BruteForceService,
  ) {}
  private readonly logger = new Logger(AuthService.name);

  async refresh(req: ReqExpress) {
    const oldRefreshToken = req.cookies.refresh_token;
    if (!oldRefreshToken) throw new UnauthorizedException('Missing refresh token');

    const payload = this.refreshTokenService.verifyToken(oldRefreshToken);
    const user = await this.userService.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    if (payload.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Refresh token revoked');
    }

    const accessToken = await this.accessTokenService.createToken({
      id: user.id,
      email: user.email,
    });

    const refreshToken = await this.refreshTokenService.rotate(oldRefreshToken);

    return { message: 'Access token refreshed successfully', accessToken, refreshToken };
  }

  async login(dto: LoginDto, bfKeys: string[]) {
    try {
      const user = await this.userService.findByEmail(dto.email);
      if (!user) {
        throw new UnauthorizedException('Invalid email or password');
      }

      const isPasswordOk = await bcrypt.compare(dto.password, user.password);
      if (!isPasswordOk) {
        throw new UnauthorizedException('Invalid email or password');
      }

      this.bruteForceService.resetMany(bfKeys);

      const { accessToken, refreshToken } = await this.createTokens(user);

      return { accessToken, refreshToken };
    } catch (err: unknown) {
      this.bruteForceService.recordFailureMany(bfKeys);
      throw err;
    }
  }

  async register(payload: RegisterDto) {
    const existingUser = await this.userService.findByEmail(payload.email);

    if (existingUser) throw new ConflictException('Email already in use');
    const hashedPassword = await bcrypt.hash(payload.password, 12);

    const user = await this.userService.createUser({
      email: payload.email,
      password: hashedPassword,
    });

    const { accessToken, refreshToken } = await this.createTokens(user);

    return { message: 'User registered successfully', refreshToken, accessToken };
  }

  async revokeAll(userId: string) {
    await this.userService.bumpTokenVersion(userId);
  }

  private async createTokens(user: User) {
    const accessToken = await this.accessTokenService.createToken(user);
    const refreshToken = await this.refreshTokenService.createToken(user);

    return { accessToken, refreshToken };
  }
}
