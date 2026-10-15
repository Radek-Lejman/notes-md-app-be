import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import refreshJwtConfig from 'src/modules/auth/config/refreshJwt.config';
import { createTestApp, registerUser, resetDb } from './support/app';

describe('Auth refresh (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  afterAll(async () => {
    await app.close();
  });

  /** POST /auth/refresh with a valid CSRF pair and the given refresh cookie, without a session. */
  const refreshWith = async (refreshToken: string) => {
    const csrf = await request(app.getHttpServer()).get('/api/csrf-token').expect(200);
    const csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
    const csrfCookie = ([] as string[])
      .concat(csrf.headers['set-cookie'] ?? [])
      .map((cookie) => cookie.split(';')[0])
      .find((cookie) => cookie.startsWith('XSRF-TOKEN='));

    return request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', `${csrfCookie}; refresh_token=${refreshToken}`);
  };

  const payload = { sub: 'user-1', email: 'a@e2e.test', jti: 'jti-1', tokenVersion: 0 };

  it('refreshes the session of a registered user', async () => {
    const user = await registerUser(app);
    // No @HttpCode on the route, so a successful refresh answers 201.
    await user.agent.post('/api/auth/refresh').set('X-CSRF-Token', user.csrfToken).expect(201);
  });

  // D1: these used to end in a 500.
  it('rejects a malformed refresh token with 401', async () => {
    expect((await refreshWith('garbage')).status).toBe(401);
  });

  it('rejects a refresh token signed with another secret with 401', async () => {
    const forged = new JwtService().sign(payload, { secret: 'not-the-refresh-secret'.padEnd(32) });
    expect((await refreshWith(forged)).status).toBe(401);
  });

  it('rejects an expired refresh token with 401', async () => {
    const config = app.get<ConfigType<typeof refreshJwtConfig>>(refreshJwtConfig.KEY);
    const expired = new JwtService().sign(
      { ...payload, exp: Math.floor(Date.now() / 1000) - 60 },
      { secret: config.secret },
    );
    expect((await refreshWith(expired)).status).toBe(401);
  });
});
