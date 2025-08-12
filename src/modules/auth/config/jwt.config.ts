import { registerAs } from '@nestjs/config';
import { JwtSignOptions } from '@nestjs/jwt';
import { jwtAccessTokenConstant } from '../constants';

export default registerAs('jwt', () => ({
  secret: jwtAccessTokenConstant.secret,
  expiresIn: jwtAccessTokenConstant.expire_in,
}));
