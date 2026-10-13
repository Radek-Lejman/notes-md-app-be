import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from './support/app';

describe('App (e2e smoke)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the public CSRF endpoint under the /api prefix', async () => {
    const res = await request(app.getHttpServer()).get('/api/csrf-token').expect(200);

    expect(typeof (res.body as { csrfToken?: unknown }).csrfToken).toBe('string');
  });

  it('rejects a request without a session', async () => {
    await request(app.getHttpServer()).get('/api/notes').expect(401);
  });
});
