import { registerAs } from '@nestjs/config';
import { JwtSignOptions } from '@nestjs/jwt';
import { jwtAccessTokenConstant } from '../constants';

export default registerAs(
  'jwt',
  (): JwtSignOptions => ({
    accessTokenSecret: jwtAccessTokenConstant.secret,
    accessTokenExpiresIn: jwtAccessTokenConstant.expire_in,
  }),
);
