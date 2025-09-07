import { Response } from 'express';
import { serialize } from 'cookie';
import { daysToSeconds, minutesToSeconds } from 'src/common/utils/time';
import { accessTokenExpireIn, refreshTokenExpireIn } from '../constants';
import { isProd } from 'src/common/utils/env';

export function setAuthCookies(res: Response, accessToken?: string, refreshToken?: string): void {
  const accessMaxAge = accessToken ? minutesToSeconds(+accessTokenExpireIn) : 0;
  const refreshMaxAge = refreshToken ? daysToSeconds(+refreshTokenExpireIn) : 0;

  const common = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
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
