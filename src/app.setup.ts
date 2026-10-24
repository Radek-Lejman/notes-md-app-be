import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { corsConfig, csrfMiddleware, helmetConfig, hstsConfig, trustProxyHops } from '@security';

/**
 * HTTP pipeline shared by main.ts and the e2e tests, so the tests exercise the same
 * application as production (prefix, cookies, CSRF, CORS, security headers, validation).
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  // Client IP for brute force and throttling (see trustProxyHops).
  const proxyHops = trustProxyHops();
  if (proxyHops > 0) app.set('trust proxy', proxyHops);
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
