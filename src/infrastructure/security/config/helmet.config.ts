import helmet from 'helmet';
import { isProd } from 'src/core/config/env';
import ms from 'ms';

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

// TODO - move to time filder
const seconds = (time: string) => Math.floor(ms(time) / 1000);

export const hstsConfig = () =>
  helmet.hsts({
    maxAge: seconds('7d'),
    includeSubDomains: true,
    preload: true,
  });
