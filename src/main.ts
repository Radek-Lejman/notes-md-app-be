import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { csrfMiddleware } from './config/csrf.config';
import { corsConfig } from './config/cors.config';
import { helmetConfig, hstsConfig } from './config/helmet.config';
import { ThrottlerExceptionFilter } from './common/utils/throttler-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.use(cookieParser());
  app.use(csrfMiddleware);
  app.enableCors(corsConfig);
  app.use(helmetConfig());
  app.use(hstsConfig());
  app.useGlobalFilters(new ThrottlerExceptionFilter());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
