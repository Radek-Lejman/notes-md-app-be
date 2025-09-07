import * as csurf from 'csurf';
import { isProd } from 'src/common/utils/env';

export const csrfMiddleware = csurf({
  cookie: {
    key: 'XSRF-TOKEN',
    httpOnly: true,
    sameSite: isProd ? 'strict' : 'lax',
    secure: isProd,
  },
});
