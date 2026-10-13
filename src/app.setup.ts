import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { corsConfig, csrfMiddleware, helmetConfig, hstsConfig } from '@security';

/**
 * HTTP pipeline shared by main.ts and the e2e tests, so the tests exercise the same
 * application as production (prefix, cookies, CSRF, CORS, security headers, validation).
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  // Express defaults to 100kb; a full AI chat (MAX_CHAT_MESSAGES x MAX_CHAT_MESSAGE_LENGTH) needs more.
  app.useBodyParser('json', { limit: '2mb' });
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
