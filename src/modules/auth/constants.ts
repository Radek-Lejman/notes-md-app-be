import { envNumber, envSecret } from 'src/common/utils/env';
import { DaysJwtConfigString, MinutesJwtConfigString } from './interfaces/jwt.interface';
export const accessTokenExpireIn = envNumber('JWT_ACCESS_EXPIRE_IN', {
  default: 15,
  min: 1,
  max: 60,
});
export const refreshTokenExpireIn = envNumber('JWT_REFRESH_EXPIRE_IN', {
  default: 7,
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

export const jwtRefreshTokenConstants: {
  secret: string;
  expire_in: DaysJwtConfigString;
} = {
  secret: envSecret('JWT_REFRESH_SECRET', 'default-refresh-secret'),
  expire_in: `${refreshTokenExpireIn}d`,
};
