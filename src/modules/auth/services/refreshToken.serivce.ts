import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { User } from '@prisma/client';
import { UsersService } from 'src/modules/users/users.service';
import { IssuedRefreshToken, RefreshTokenPayload } from '../interfaces/jwt.interface';
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

  async createToken(user: User): Promise<IssuedRefreshToken> {
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

    const token = await this.jwtNestService.signAsync(refreshPayload, this.refreshConfig);
    return { token, jti };
  }

  async rotate(oldToken: string): Promise<IssuedRefreshToken> {
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

    // Revoke the old token atomically: of two parallel refreshes with the same token only one
    // wins, so a copied token cannot fork a second live session.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { jti: payload.jti, revoked: false },
      data: { revoked: true },
    });
    if (count !== 1) {
      this.logger.warn('Token reuse detected');
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const user = await this.userService.findById(payload.sub);

    if (!user) throw new UnauthorizedException('User not found');

    return await this.createToken(user);
  }

  /** Revokes one session's refresh token; scoped by userId, so a foreign jti changes nothing. */
  async revoke(jti: string, userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { jti, userId, revoked: false },
      data: { revoked: true },
    });
  }

  async revokeAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  verifyToken(token: string): RefreshTokenPayload {
    // Pin the algorithm we sign with, so a token can never choose its own (e.g. `none`).
    return this.jwtNestService.verify(token, { ...this.refreshConfig, algorithms: ['HS256'] });
  }
}
