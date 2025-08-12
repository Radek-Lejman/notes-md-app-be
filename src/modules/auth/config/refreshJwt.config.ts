import { registerAs } from '@nestjs/config';
import { JwtSignOptions } from '@nestjs/jwt';
import { jwtRefreshTokenConstants } from '../constants';

export default registerAs(
  'refresh-jwt',
  (): JwtSignOptions => ({
    accessTokenSecret: jwtRefreshTokenConstants.secret,
    accessTokenExpiresIn: jwtRefreshTokenConstants.expire_in,
  }),
);
