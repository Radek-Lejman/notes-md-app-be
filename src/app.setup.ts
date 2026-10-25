import cookieParser from 'cookie-parser';
import { json } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { corsConfig, csrfMiddleware, helmetConfig, hstsConfig, trustProxyHops } from '@security';
import { IMPORT_BODY_LIMIT } from './modules/notes/consts/import.consts';

/** The one route with a larger JSON body limit; `setGlobalPrefix` does not apply to `app.use`. */
export const IMPORT_ROUTE = '/api/notes/import';

/**
 * HTTP pipeline shared by main.ts and the e2e tests, so the tests exercise the same
 * application as production (prefix, cookies, CSRF, CORS, security headers, validation).
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  // Client IP for brute force and throttling (see trustProxyHops).
  const proxyHops = trustProxyHops();
  if (proxyHops > 0) app.set('trust proxy', proxyHops);
  // Note import sends many files in one JSON body. Mounted before the global parser, which then
  // skips the already-read body. This runs before the JWT guard, so CSRF goes first: a request
  // without a valid token gets 403 before 25 MB are buffered (the global CSRF middleware below
  // checks it again, harmlessly).
  app.use(
    IMPORT_ROUTE,
    cookieParser(),
    csrfMiddleware,
    json({ limit: IMPORT_BODY_LIMIT, inflate: false }),
  );
  // Express defaults to 100kb; a full AI chat (MAX_CHAT_MESSAGES x MAX_CHAT_MESSAGE_LENGTH) needs more.
  // `inflate: false`: compressed request bodies (Content-Encoding: gzip/deflate/br) get 415.
  // No client sends them, so the decompression path stays out of reach (defence in depth for
  // decompression bugs such as GHSA-27r3-jxmh-p828, fixed in body-parser 2.4.0).
  app.useBodyParser('json', { limit: '2mb', inflate: false });
  // Nest's default urlencoded parser, only with `inflate: false` for the same reason.
  app.useBodyParser('urlencoded', { extended: true, inflate: false });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(csrfMiddleware);
  app.enableCors(corsConfig);
  app.use(helmetConfig());
  app.use(hstsConfig());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      forbidNonWhitelisted: true,
    }),
  );
  return app;
}
