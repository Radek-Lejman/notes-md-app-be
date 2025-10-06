import { registerAs } from '@nestjs/config';
import { envNumber, envSecret } from 'src/core/config/env';
import { DaysJwtConfigString } from '../interfaces/jwt.interface';

export const refreshTokenExpireIn = envNumber('JWT_REFRESH_EXPIRE_IN', {
  default: 7,
  min: 1,
  max: 60,
});

export const jwtRefreshTokenConstants: {
  secret: string;
  expire_in: DaysJwtConfigString;
} = {
  secret: envSecret('JWT_REFRESH_SECRET', 'default-refresh-secret'),
  expire_in: `${refreshTokenExpireIn}d`,
};

export default registerAs('refresh-jwt', () => ({
  secret: jwtRefreshTokenConstants.secret,
  expiresIn: jwtRefreshTokenConstants.expire_in,
}));
