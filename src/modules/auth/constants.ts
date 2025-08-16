import { envNumber, envString } from 'src/common/utils/env';

export const accessTokenExpireIn = envNumber('JWT_ACCESS_EXPIRE_IN', 15);
export const refreshTokenExpireIn = envNumber('JWT_REFRESH_EXPIRE_IN', 7);

export const jwtAccessTokenConstant = {
  secret: envString('JWT_ACCESS_SECRET', 'default-access-secret'),
  expire_in: `${accessTokenExpireIn}m`,
};

export const jwtRefreshTokenConstants = {
  secret: envString('JWT_REFRESH_SECRET', 'default-refresh-secret'),
  expire_in: `${refreshTokenExpireIn}d`,
};
