import { Injectable, Inject, Logger } from '@nestjs/common';
import accessTokenConfig from '../config/jwt.config';
import refreshJwtConfig from '../config/refreshJwt.config';
import { User } from 'src/modules/users/interfaces/user.interface';
import { JwtService as JwtNestService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';

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

  async createTokens(user: User) {
    const payload = { sub: user.id, username: user.email };

    const accessToken = await this.jwtNestService.signAsync(payload, this.accessConfig);
    const refreshToken = await this.jwtNestService.signAsync(payload, this.refreshConfig);

    this.logger.log(`Tokens created`);
    return { accessToken, refreshToken };
  }

  verifyAccessToken(token: string) {
    return this.jwtNestService.verify(token, this.accessConfig) as User;
  }

  verifyRefreshToken(token: string) {
    return this.jwtNestService.verify(token, this.refreshConfig) as User;
  }
}
