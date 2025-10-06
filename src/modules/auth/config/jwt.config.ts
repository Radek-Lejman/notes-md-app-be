import { registerAs } from '@nestjs/config';
import { envNumber, envSecret } from 'src/core/config/env';
import { MinutesJwtConfigString } from '../interfaces/jwt.interface';

export const accessTokenExpireIn = envNumber('JWT_ACCESS_EXPIRE_IN', {
  default: 15,
  min: 1,
  max: 60,
});

export const jwtAccessTokenConstant: {
  secret: string;
  expire_in: MinutesJwtConfigString;
} = {
  secret: envSecret('JWT_ACCESS_SECRET', 'default-access-secret'),
  expire_in: `${accessTokenExpireIn}m`,
};

export default registerAs('jwt', () => ({
  secret: jwtAccessTokenConstant.secret,
  expiresIn: jwtAccessTokenConstant.expire_in,
}));
