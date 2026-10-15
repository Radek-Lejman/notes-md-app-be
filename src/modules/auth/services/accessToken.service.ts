import { Injectable, Inject, Logger, UnauthorizedException } from '@nestjs/common';
import accessTokenConfig from '../config/jwt.config';
import { User } from 'src/modules/users/interfaces/user.interface';
import { JwtService as JwtNestService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { AccessTokenPayload } from '../interfaces/jwt.interface';
import { UsersService } from 'src/modules/users/users.service';

@Injectable()
export class AccessTokenService {
  constructor(
    private jwtNestService: JwtNestService,
    @Inject(accessTokenConfig.KEY)
    private readonly accessConfig: ConfigType<typeof accessTokenConfig>,
    private readonly usersService: UsersService,
  ) {}

  private readonly logger = new Logger(AccessTokenService.name);

  public async createToken(user: Pick<User, 'id' | 'email' | 'tokenVersion'>) {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    };

    return this.jwtNestService.signAsync(accessPayload, this.accessConfig);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwtNestService.verify(token, this.accessConfig);
  }

  /**
   * Verifies the token and checks that the session was not revoked since it was issued
   * (deleted user, or "log out everywhere" bumped the token version). Costs one DB lookup.
   * Throws JsonWebTokenError for a bad token, UnauthorizedException for a revoked session.
   */
  async authenticate(token: string): Promise<AccessTokenPayload> {
    const payload = this.verifyAccessToken(token);
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session revoked');
    }
    return payload;
  }
}
