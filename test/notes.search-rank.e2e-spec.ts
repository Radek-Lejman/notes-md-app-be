import { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp, registerUser, resetDb, TestUser } from './support/app';

interface SearchHit {
  title: string;
}

/** Relevance ordering (order=rank / -rank), computed in the database. */
describe('Notes search ranking (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    alice = await registerUser(app);

    for (const note of [
      { title: 'Inne sprawy', content: 'docker wspomniany raz' },
      { title: 'Docker', content: 'docker docker, obrazy dockera' },
      { title: 'Dockerfile', content: 'bez słowa w treści' },
      { title: 'Żółw', content: 'zwierzę' },
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

  const ranked = async (order: string, q = 'docker') => {
    const res = await alice.agent
      .get('/api/notes/search')
      .query({ q, fields: 'title', order })
      .expect(200);
    return (res.body as SearchHit[]).map((hit) => hit.title);
  };

  // Used to be the other way round: `rank` (the FE default, "Relevance ↓") sorted ascending.
  it('rank puts the best match first: title and content above content only', async () => {
    const titles = await ranked('rank');
    expect(titles).toHaveLength(3);
    expect(titles[0]).toBe('Docker');
    expect(titles[2]).toBe('Inne sprawy');
  });

  it('-rank is the reverse order', async () => {
    expect(await ranked('-rank')).toEqual((await ranked('rank')).reverse());
  });

  it('ranks matches found without diacritics too', async () => {
    expect(await ranked('rank', 'zolw')).toEqual(['Żółw']);
  });
});
