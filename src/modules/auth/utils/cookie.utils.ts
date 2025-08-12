import { Response } from 'express';
import { serialize } from 'cookie';
import { daysToSeconds, minutesToSeconds } from 'src/common/utils/time';
import { accessTokenExpireIn, refreshTokenExpireIn } from '../constants';

export function setAuthCookies(res: Response, accessToken?: string, refreshToken?: string): void {
  const isProd = process.env.NODE_ENV === 'production';

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
