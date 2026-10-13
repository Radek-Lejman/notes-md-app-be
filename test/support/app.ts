import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { PrismaService } from '@database/prisma/prisma.service';

/** The production AppModule with the production HTTP pipeline (see src/app.setup.ts). */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

/** Empties every application table (keeps the migrations table). */
export async function resetDb(app: NestExpressApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export interface TestUser {
  email: string;
  /** Keeps the session and CSRF cookies between requests. */
  agent: TestAgent;
  /** Send as `X-CSRF-Token` on every non-GET request. */
  csrfToken: string;
}

let userSeq = 0;

/** Registers a new user the way the FE does: CSRF token first, then POST /api/auth/register. */
export async function registerUser(app: NestExpressApplication): Promise<TestUser> {
  const agent = request.agent(app.getHttpServer());
  const csrf = await agent.get('/api/csrf-token').expect(200);
  const csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
  const email = `user${++userSeq}-${Date.now()}@e2e.test`;

  await agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', csrfToken)
    .send({ email, password: 'e2e-password-123' })
    .expect(201);

  return { email, agent, csrfToken };
}
