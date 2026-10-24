import { NestExpressApplication } from '@nestjs/platform-express';
import { gzipSync } from 'zlib';
import request from 'supertest';
import { createTestApp } from './support/app';

/**
 * Listens once on 127.0.0.1 so supertest reuses this server instead of binding a new random
 * port per request (on macOS such a port can already be taken on 127.0.0.1 by another local
 * process, and the request then lands there: random 404s / "socket hang up").
 */
async function listening(app: NestExpressApplication): Promise<NestExpressApplication> {
  await app.listen(0, '127.0.0.1');
  return app;
}

/** Compressed request bodies are refused before any decompression (see configureApp). */
describe('Request body parsing (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await listening(await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['JSON', 'application/json', JSON.stringify({ email: 'a@e2e.test', password: 'x' })],
    ['form', 'application/x-www-form-urlencoded', 'email=a%40e2e.test&password=x'],
  ])('rejects a gzip-compressed %s body with 415', async (_case, contentType, body) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', contentType)
      .set('Content-Encoding', 'gzip')
      .send(gzipSync(body));

    expect(res.status).toBe(415);
  });

  it('still parses a plain JSON body', async () => {
    // Reaches the CSRF check, i.e. the body was accepted by the parser.
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'a@e2e.test', password: 'x' });

    expect(res.status).toBe(403);
  });
});
