import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { csrfMiddleware } from './config/csrf.config';
import { corsConfig } from './config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.use(cookieParser());
  app.use(csrfMiddleware);
  app.enableCors(corsConfig);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
