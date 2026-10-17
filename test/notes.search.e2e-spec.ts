import { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp, registerUser, resetDb, TestUser } from './support/app';

interface SearchHit {
  id: string;
  title: string;
}

describe('Notes full-text search (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(app);
    alice = await registerUser(app);
    bob = await registerUser(app);

    for (const note of [
      { title: 'Plan na wakacje', content: 'Wyjazd nad morze w lipcu 2026' },
      { title: 'Zakupy', content: 'Lista rzeczy, o których pisałem w notatkach' },
    ]) {
      await alice.agent
        .post('/api/notes')
        .set('X-CSRF-Token', alice.csrfToken)
        .send(note)
        .expect(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const search = async (user: TestUser, q: string) => {
    const res = await user.agent.get('/api/notes/search').query({ q, fields: 'title' }).expect(200);
    return (res.body as SearchHit[]).map((hit) => hit.title).sort();
  };

  // Used to fail: the prefix query reached plainto_tsquery, which drops `:*`.
  it('matches the beginning of a word in the title and in the content', async () => {
    expect(await search(alice, 'wakac')).toEqual(['Plan na wakacje']);
    expect(await search(alice, 'notat')).toEqual(['Zakupy']);
  });

  it('is case-insensitive and requires every word', async () => {
    expect(await search(alice, 'WYJAZD lipc')).toEqual(['Plan na wakacje']);
    expect(await search(alice, 'wyjazd zakupy')).toEqual([]);
  });

  it('answers 200 with no results for input without words', async () => {
    expect(await search(alice, '- -- ()')).toEqual([]);
  });

  /** Authorization convention (AC-AUTHZ): search never returns another user's notes. */
  it("does not return other users' notes", async () => {
    expect(await search(bob, 'wakac')).toEqual([]);
  });
});
