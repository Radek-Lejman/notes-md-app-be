import 'express-serve-static-core';

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
