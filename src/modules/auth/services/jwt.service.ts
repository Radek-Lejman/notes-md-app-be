import { Injectable, Inject, Logger } from '@nestjs/common';
import accessTokenConfig from '../config/jwt.config';
import refreshJwtConfig from '../config/refreshJwt.config';
import { User } from 'src/modules/users/interfaces/user.interface';
import { JwtService as JwtNestService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { JwtPayload, RefreshPayload } from '../interfaces/jwt.interface';

@Injectable()
export class JwtInnerService {
  constructor(
    private jwtNestService: JwtNestService,
    @Inject(accessTokenConfig.KEY)
    private readonly accessConfig: ConfigType<typeof accessTokenConfig>,
    @Inject(refreshJwtConfig.KEY)
    private readonly refreshConfig: ConfigType<typeof refreshJwtConfig>,
  ) {}

  private readonly logger = new Logger(JwtInnerService.name);

  async createTokens(user: Pick<User, 'id' | 'email' | 'tokenVersion'>) {
    const accessPayload: JwtPayload = { sub: user.id, email: user.email };
    const refreshPayload: RefreshPayload = {
      ...accessPayload,
      tokenVersion: user.tokenVersion,
    };

    const accessToken = await this.jwtNestService.signAsync(accessPayload, this.accessConfig);
    const refreshToken = await this.jwtNestService.signAsync(refreshPayload, this.refreshConfig);

    this.logger.log(`Tokens created`);
    return { accessToken, refreshToken };
  }

  verifyAccessToken(token: string): JwtPayload {
    return this.jwtNestService.verify(token, this.accessConfig);
  }

  verifyRefreshToken(token: string): RefreshPayload {
    return this.jwtNestService.verify(token, this.refreshConfig);
  }
}
