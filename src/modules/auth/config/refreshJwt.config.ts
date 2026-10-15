import { registerAs } from '@nestjs/config';
import { DaysJwtConfigString } from '../interfaces/jwt.interface';
import { envNumber, envSecret } from '@core/config';

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

export default registerAs('refresh-jwt', () => ({
  secret: jwtRefreshTokenConstants.secret,
  expiresIn: jwtRefreshTokenConstants.expire_in,
}));
