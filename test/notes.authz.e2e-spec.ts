import { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp, registerUser, resetDb, TestUser } from './support/app';

interface NoteBody {
  id: string;
  title: string;
  parentId?: string | null;
}

/** Authorization convention (KONCEPCJA §3, layer 2): user B gets 404 on user A's resources. */
describe('Notes authorization (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestUser;
  let bob: TestUser;
  let aliceNote: NoteBody;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(app);
    alice = await registerUser(app);
    bob = await registerUser(app);

    const created = await alice.agent
      .post('/api/notes')
      .set('X-CSRF-Token', alice.csrfToken)
      .send({ title: 'Alice private note', content: 'secret content of alice' })
      .expect(200);
    aliceNote = created.body as NoteBody;
  });

  afterAll(async () => {
    await app.close();
  });

  const titleOfAliceNote = async () => {
    const res = await alice.agent.get(`/api/notes/${aliceNote.id}`).expect(200);
    return (res.body as NoteBody).title;
  };

  describe('controls (prove that a 404 below is not a broken setup)', () => {
    it('A reads her own note', async () => {
      expect(await titleOfAliceNote()).toBe('Alice private note');
    });

    it('A updates her own note (session + CSRF work for writes)', async () => {
      await alice.agent
        .patch(`/api/notes/${aliceNote.id}`)
        .set('X-CSRF-Token', alice.csrfToken)
        .send({ title: 'Renamed by Alice' })
        .expect(200);

      expect(await titleOfAliceNote()).toBe('Renamed by Alice');
    });
  });

  it("AC-AUTHZ: B gets 404 on GET /api/notes/:id of A's note", async () => {
    const res = await bob.agent.get(`/api/notes/${aliceNote.id}`).expect(404);

    expect(JSON.stringify(res.body)).not.toContain('Alice private note');
    expect(JSON.stringify(res.body)).not.toContain('secret content of alice');
  });

  it("AC-AUTHZ: B's GET /api/notes does not list A's notes", async () => {
    const res = await bob.agent.get('/api/notes').expect(200);

    expect((res.body as NoteBody[]).map((n) => n.id)).not.toContain(aliceNote.id);
  });

  it("AC-AUTHZ: B's PATCH does not modify A's note", async () => {
    const res = await bob.agent
      .patch(`/api/notes/${aliceNote.id}`)
      .set('X-CSRF-Token', bob.csrfToken)
      .send({ title: 'Hacked by Bob' });

    // Not 401/403: those would mean the session or CSRF setup is broken, not that authz works.
    expect([404, 500]).toContain(res.status);
    expect(await titleOfAliceNote()).toBe('Alice private note');
  });

  // D5: Prisma P2025 from update({ where: { id, userId } }) is not mapped, so the API answers 500.
  it.failing("AC-AUTHZ: B's PATCH on A's note returns 404 (see D5)", async () => {
    await bob.agent
      .patch(`/api/notes/${aliceNote.id}`)
      .set('X-CSRF-Token', bob.csrfToken)
      .send({ title: 'Hacked by Bob' })
      .expect(404);
  });

  // D14: parentId is not checked for ownership, so B can attach a note under A's note (200).
  // Reads do not leak (children are scoped by userId), but it links data across accounts.
  it.failing("AC-AUTHZ: B cannot create a note under A's note (parentId, see D14)", async () => {
    const res = await bob.agent
      .post('/api/notes')
      .set('X-CSRF-Token', bob.csrfToken)
      .send({ title: 'Bob child', content: 'x', parentId: aliceNote.id });

    expect([400, 404]).toContain(res.status);
  });
});
