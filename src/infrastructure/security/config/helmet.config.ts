import helmet from 'helmet';
import { isProd } from 'src/core/config/env';
import { toSeconds } from '@common/utils';

export const helmetConfig = () => {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'connect-src': ["'self'", 'http://localhost:5173'],
      },
    },
    crossOriginEmbedderPolicy: isProd ? { policy: 'require-corp' } : false,
    frameguard: { action: 'deny' },
    noSniff: true,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    dnsPrefetchControl: { allow: false },
  });
};

export const hstsConfig = () =>
  helmet.hsts({
    maxAge: toSeconds('7d'),
    includeSubDomains: true,
    preload: true,
  });
