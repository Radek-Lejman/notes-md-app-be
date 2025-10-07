import { Response } from 'express';
import { serialize } from 'cookie';
import { isProd } from 'src/core/config/env';
import { accessTokenExpireIn } from '../config/jwt.config';
import { refreshTokenExpireIn } from '../config/refreshJwt.config';
import { daysToSeconds, minutesToSeconds } from '@common/utils';

export function setAuthCookies(res: Response, accessToken?: string, refreshToken?: string): void {
  const accessMaxAge = accessToken ? minutesToSeconds(Number(accessTokenExpireIn)) : 0;
  const refreshMaxAge = refreshToken ? daysToSeconds(Number(refreshTokenExpireIn)) : 0;

  const common = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ('strict' as const) : ('lax' as const),
    path: '/',
  };

  const accessCookie = serialize('access_token', accessToken ?? '', {
    ...common,
    maxAge: accessMaxAge,
  });

  const refreshCookie = serialize('refresh_token', refreshToken ?? '', {
    ...common,
    maxAge: refreshMaxAge,
  });

  res.setHeader('Set-Cookie', [accessCookie, refreshCookie]);
}
