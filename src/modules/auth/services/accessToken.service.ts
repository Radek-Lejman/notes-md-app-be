import { Injectable, Inject, Logger } from '@nestjs/common';
import accessTokenConfig from '../config/jwt.config';
import { User } from 'src/modules/users/interfaces/user.interface';
import { JwtService as JwtNestService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { AccessTokenPayload } from '../interfaces/jwt.interface';

@Injectable()
export class AccessTokenService {
  constructor(
    private jwtNestService: JwtNestService,
    @Inject(accessTokenConfig.KEY)
    private readonly accessConfig: ConfigType<typeof accessTokenConfig>,
  ) {}

  private readonly logger = new Logger(AccessTokenService.name);

  public async createToken(user: Pick<User, 'id' | 'email'>) {
    const accessPayload: AccessTokenPayload = { sub: user.id, email: user.email };

    return this.jwtNestService.signAsync(accessPayload, this.accessConfig);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwtNestService.verify(token, this.accessConfig);
  }
}
