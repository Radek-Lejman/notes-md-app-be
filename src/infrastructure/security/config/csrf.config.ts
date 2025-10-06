import csurf from 'csurf';
import { isProd } from 'src/core/config/env';

export const csrfMiddleware = csurf({
  cookie: {
    key: 'XSRF-TOKEN',
    httpOnly: true,
    sameSite: isProd ? 'strict' : 'lax',
    secure: isProd,
  },
});
