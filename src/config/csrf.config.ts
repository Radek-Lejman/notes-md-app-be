import * as csurf from 'csurf';
import { Environment } from './env.enum';

export const csrfMiddleware = csurf({
  cookie: {
    key: 'XSRF-TOKEN',
    httpOnly: false,
    sameSite: process.env.NODE_ENV === Environment.Production ? 'strict' : 'lax',
    secure: process.env.NODE_ENV === Environment.Production,
  },
});
