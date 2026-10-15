import { registerAs } from '@nestjs/config';
import { DaysJwtConfigString } from '../interfaces/jwt.interface';
import { envNumber, envSecret } from '@core/config';
import { jwtAccessTokenConstant } from './jwt.config';

export const refreshTokenExpireIn = envNumber('JWT_REFRESH_EXPIRE_IN', {
  default: 7,
  min: 1,
  max: 60,
});

export const jwtRefreshTokenConstants: {
  secret: string;
  expire_in: DaysJwtConfigString;
} = {
  // No dev fallback, see jwt.config.ts.
  secret: envSecret('JWT_REFRESH_SECRET'),
  expire_in: `${refreshTokenExpireIn}d`,
};

// With one shared secret a 7-day refresh token would also pass as an access token.
if (jwtRefreshTokenConstants.secret === jwtAccessTokenConstant.secret) {
  throw new Error('[config] JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET');
}

export default registerAs('refresh-jwt', () => ({
  secret: jwtRefreshTokenConstants.secret,
  expiresIn: jwtRefreshTokenConstants.expire_in,
}));
