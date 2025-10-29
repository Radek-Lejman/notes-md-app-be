import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { User } from '@prisma/client';
import { UsersService } from 'src/modules/users/users.service';
import { RefreshTokenPayload } from '../interfaces/jwt.interface';
import refreshJwtConfig from '../config/refreshJwt.config';
import { ConfigType } from '@nestjs/config';
import { JwtService as JwtNestService } from '@nestjs/jwt';
import { calculateExpiresAt } from '../utils/expiresIn';
import { PrismaService } from '@database/prisma';

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UsersService,
    private jwtNestService: JwtNestService,
    @Inject(refreshJwtConfig.KEY)
    private readonly refreshConfig: ConfigType<typeof refreshJwtConfig>,
  ) {}

  async createToken(user: User) {
    const jti = randomUUID();
    const expiresAt = calculateExpiresAt(this.refreshConfig.expiresIn);

    await this.prisma.refreshToken.create({
      data: {
        jti,
        userId: user.id,
        expiresAt,
      },
    });

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      email: user.email,
      jti: jti,
      tokenVersion: user.tokenVersion,
    };

    return this.jwtNestService.signAsync(refreshPayload, this.refreshConfig);
  }

  async rotate(oldToken: string) {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.verifyToken(oldToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });

    if (!tokenRecord || tokenRecord.revoked) {
      this.logger.warn('Token reuse detected');
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // revoke old token
    await this.prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: { revoked: true },
    });

    const user = await this.userService.findById(payload.sub);

    if (!user) throw new UnauthorizedException('User not found');

    return await this.createToken(user);
  }

  async revokeAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  verifyToken(token: string): RefreshTokenPayload {
    return this.jwtNestService.verify(token, this.refreshConfig);
  }
}
