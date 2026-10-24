import 'express-serve-static-core';
import type { AccessTokenPayload } from 'src/modules/auth/interfaces/jwt.interface';

declare module 'express-serve-static-core' {
  interface Request {
    csrfToken: () => string;
  }
}
declare module 'express-serve-static-core' {
  interface Request {
    __bfKeys?: string[];
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by JwtAuthGuard from the verified access token. */
    user?: AccessTokenPayload;
  }
}
