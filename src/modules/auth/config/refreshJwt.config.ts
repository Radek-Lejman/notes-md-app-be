import { registerAs } from '@nestjs/config';
import { jwtRefreshTokenConstants } from '../constants';

export default registerAs('refresh-jwt', () => ({
  secret: jwtRefreshTokenConstants.secret,
  expiresIn: jwtRefreshTokenConstants.expire_in,
}));
