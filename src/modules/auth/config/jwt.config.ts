import { registerAs } from '@nestjs/config';
import { MinutesJwtConfigString } from '../interfaces/jwt.interface';
import { envNumber, envSecret } from '@core/config';

export const accessTokenExpireIn = envNumber('JWT_ACCESS_EXPIRE_IN', {
  default: 15,
  min: 1,
  max: 60,
});

export const jwtAccessTokenConstant: {
  secret: string;
  expire_in: MinutesJwtConfigString;
} = {
  // No dev fallback: a secret known from the repo would let anyone forge sessions on any
  // deployment that does not set NODE_ENV=production.
  secret: envSecret('JWT_ACCESS_SECRET'),
  expire_in: `${accessTokenExpireIn}m`,
};

export default registerAs('jwt', () => ({
  secret: jwtAccessTokenConstant.secret,
  expiresIn: jwtAccessTokenConstant.expire_in,
}));
