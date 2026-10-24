import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { bruteForceConfig } from '@security';
import { createTestApp, registerUser, resetDb, TestUser } from './support/app';

/**
 * Listens once on 127.0.0.1 so supertest reuses this server instead of binding a new random
 * port per request (on macOS such a port can already be taken on 127.0.0.1 by another local
 * process, and the request then lands there: random 404s / "socket hang up").
 */
async function listening(app: NestExpressApplication): Promise<NestExpressApplication> {
  await app.listen(0, '127.0.0.1');
  return app;
}

const PASSWORD = 'e2e-password-123';

/** A fresh client with its own CSRF pair; `ip` goes into X-Forwarded-For. */
async function client(app: NestExpressApplication, ip?: string) {
  const agent = request.agent(app.getHttpServer());
  if (ip) agent.set('X-Forwarded-For', ip);
  const csrf = await agent.get('/api/csrf-token').expect(200);
  return { agent, csrfToken: (csrf.body as { csrfToken: string }).csrfToken };
}

async function login(app: NestExpressApplication, email: string, password: string, ip?: string) {
  const { agent, csrfToken } = await client(app, ip);
  const res = await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', csrfToken)
    .send({ email, password });
  return { res, agent, csrfToken };
}

/** The refresh_token value from a Set-Cookie response (it is scoped to /api/auth/refresh). */
function refreshCookie(res: request.Response): string {
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('refresh_token=') && !c.startsWith('refresh_token=;'));
  if (!cookie) throw new Error('no refresh_token cookie in the response');
  return cookie.split(';')[0].slice('refresh_token='.length);
}

/** POST /auth/refresh with only the given refresh token, as an attacker who copied it would. */
async function refreshWith(app: NestExpressApplication, refreshToken: string) {
  const csrf = await request(app.getHttpServer()).get('/api/csrf-token').expect(200);
  const csrfCookie = ([] as string[])
    .concat(csrf.headers['set-cookie'] ?? [])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('XSRF-TOKEN='));
  return request(app.getHttpServer())
    .post('/api/auth/refresh')
    .set('X-CSRF-Token', (csrf.body as { csrfToken: string }).csrfToken)
    .set('Cookie', `${csrfCookie}; refresh_token=${refreshToken}`);
}

const failLogins = async (app: NestExpressApplication, email: string, ip?: string) => {
  for (let i = 0; i < bruteForceConfig.maxAttempts; i++) {
    const { res } = await login(app, email, 'wrong-password', ip);
    expect(res.status).toBe(401);
  }
};

describe('Brute force behind a reverse proxy (TRUST_PROXY=1)', () => {
  let app: NestExpressApplication;
  let alice: TestUser;

  beforeAll(async () => {
    process.env.TRUST_PROXY = '1';
    app = await listening(await createTestApp());
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    alice = await registerUser(app);
  });

  it("locks the attacker's IP, but not the owner logging in from their own IP (S4)", async () => {
    await failLogins(app, alice.email, '6.6.6.6');

    const attacker = await login(app, alice.email, PASSWORD, '6.6.6.6');
    expect(attacker.res.status).toBe(429);
    expect(attacker.res.headers['retry-after']).toBeDefined();

    const owner = await login(app, alice.email, PASSWORD, '7.7.7.7');
    expect(owner.res.status).toBe(200);
  });
});

describe('Brute force without a trusted proxy', () => {
  let app: NestExpressApplication;
  let alice: TestUser;

  beforeAll(async () => {
    delete process.env.TRUST_PROXY;
    app = await listening(await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    alice = await registerUser(app);
  });

  it('ignores a spoofed X-Forwarded-For: a locked client cannot dodge the lock', async () => {
    await failLogins(app, alice.email, '6.6.6.6');

    const spoofed = await login(app, alice.email, PASSWORD, '8.8.8.8');
    expect(spoofed.res.status).toBe(429);
  });
});

describe('Logout (S11)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await listening(await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  it('revokes the refresh token of the session, so a stolen copy of it stops working', async () => {
    const { email } = await registerUser(app);
    const session = await login(app, email, PASSWORD);
    expect(session.res.status).toBe(200);
    const stolen = refreshCookie(session.res);

    await session.agent.post('/api/auth/logout').set('X-CSRF-Token', session.csrfToken).expect(201);

    const res = await refreshWith(app, stolen);
    expect(res.status).toBe(401);
  });

  it('after a refresh, logout revokes the rotated refresh token', async () => {
    const { email } = await registerUser(app);
    const session = await login(app, email, PASSWORD);
    // The agent keeps the cookies: refreshing rotates the token and the session id with it.
    const refreshed = await session.agent
      .post('/api/auth/refresh')
      .set('X-CSRF-Token', session.csrfToken)
      .expect(201);
    const rotated = refreshCookie(refreshed);

    await session.agent.post('/api/auth/logout').set('X-CSRF-Token', session.csrfToken).expect(201);

    expect((await refreshWith(app, rotated)).status).toBe(401);
  });

  it("AC-AUTHZ: user B logging out does not end user A's session", async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const aliceSession = await login(app, alice.email, PASSWORD);
    const aliceRefresh = refreshCookie(aliceSession.res);

    await bob.agent.post('/api/auth/logout').set('X-CSRF-Token', bob.csrfToken).expect(201);

    const res = await refreshWith(app, aliceRefresh);
    expect(res.status).toBe(201);
  });

  it('keeps other sessions of the same user signed in', async () => {
    const { email } = await registerUser(app);
    const laptop = await login(app, email, PASSWORD);
    const phone = await login(app, email, PASSWORD);
    const phoneRefresh = refreshCookie(phone.res);

    await laptop.agent.post('/api/auth/logout').set('X-CSRF-Token', laptop.csrfToken).expect(201);

    const res = await refreshWith(app, phoneRefresh);
    expect(res.status).toBe(201);
  });
});
