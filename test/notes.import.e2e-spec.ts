import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { createTestApp, registerUser, resetDb, TestUser } from './support/app';

interface ImportBody {
  dryRun: boolean;
  rootNoteId: string | null;
  created: number;
  skipped: { path: string; reason: string }[];
  warnings: { path: string; kind: string; detail: string }[];
}

interface NoteSummaryBody {
  id: string;
  title: string;
  parentId: string | null;
  createdAt: string;
}

interface NoteBody extends NoteSummaryBody {
  content: string;
  children?: NoteBody[];
}

const vault = [
  {
    path: 'Projects/Docker.md',
    content: '---\ntags: [devops]\n---\n# Docker\nContainers with zebrafish.',
  },
  { path: 'Projects/Ansible.md', content: 'Uses [[Docker]] for builds.' },
  { path: 'Inbox.md', content: 'See [docker](Projects/Docker.md).' },
  { path: '.obsidian/workspace.md', content: '{}' },
  { path: 'Projects/diagram.png', content: 'png' },
];

/** Note import (docs/import/IMPORT-CONCEPT.md): HTTP pipeline, tree, links, authorization. */
describe('Notes import (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    // The import route allows 5 requests a minute per client; every test starts fresh.
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    await resetDb(app);
    alice = await registerUser(app);
    bob = await registerUser(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const importAs = (user: TestUser, body: object) =>
    user.agent.post('/api/notes/import').set('X-CSRF-Token', user.csrfToken).send(body);

  const notesOf = async (user: TestUser) =>
    (await user.agent.get('/api/notes').expect(200)).body as NoteSummaryBody[];

  it('dry run reports and writes nothing', async () => {
    const res = await importAs(alice, { files: vault, dryRun: true }).expect(200);
    const body = res.body as ImportBody;

    expect(body).toMatchObject({ dryRun: true, rootNoteId: null, created: 5 });
    expect(body.skipped).toEqual(
      expect.arrayContaining([
        { path: '.obsidian/workspace.md', reason: 'hidden' },
        { path: 'Projects/diagram.png', reason: 'not-markdown' },
      ]),
    );
    expect(await notesOf(alice)).toEqual([]);
  });

  it('imports a folder as a tree, in order, with working links and search', async () => {
    const res = await importAs(alice, { files: vault, dryRun: false, name: 'My vault' }).expect(
      200,
    );
    const { rootNoteId, created } = res.body as ImportBody;
    expect(created).toBe(5);

    const root = (
      await alice.agent
        .get(`/api/notes/${rootNoteId}?expand=children&depth=2&children.fields=title,content`)
        .expect(200)
    ).body as NoteBody;
    expect(root.title).toBe('My vault');
    expect(root.parentId).toBeNull();
    expect(root.children!.map((child) => child.title)).toEqual(['Inbox', 'Projects']);
    const projects = root.children![1];
    expect(projects.children!.map((child) => child.title)).toEqual(['Ansible', 'Docker']);

    const [ansible, docker] = projects.children!;
    expect(docker.content).toBe(
      '```yaml\ntags: [devops]\n```\n\n# Docker\nContainers with zebrafish.',
    );
    expect(ansible.content).toBe(`Uses [Docker](/notes/${docker.id}) for builds.`);
    expect(root.children![0].content).toBe(`See [docker](/notes/${docker.id}).`);

    // The rewritten link points to a note of the same user.
    await alice.agent.get(`/api/notes/${docker.id}`).expect(200);

    // FTS indexes the rows on insert.
    const hits = (await alice.agent.get('/api/notes/search?q=zebrafish&fields=title').expect(200))
      .body as { id: string }[];
    expect(hits.map((hit) => hit.id)).toEqual([docker.id]);
  });

  it('puts the import under an owned target note', async () => {
    const target = (
      await alice.agent
        .post('/api/notes')
        .set('X-CSRF-Token', alice.csrfToken)
        .send({ title: 'Imports', content: '' })
        .expect(200)
    ).body as NoteSummaryBody;

    const res = await importAs(alice, {
      files: [{ path: 'a note.md', content: 'x' }],
      dryRun: false,
      targetParentId: target.id,
    }).expect(200);

    const root = (await alice.agent.get(`/api/notes/${(res.body as ImportBody).rootNoteId}`))
      .body as NoteSummaryBody;
    expect(root.parentId).toBe(target.id);
  });

  describe('AC-AUTHZ', () => {
    it("B gets 404 importing under A's note and nothing is written", async () => {
      const aliceNote = (
        await alice.agent
          .post('/api/notes')
          .set('X-CSRF-Token', alice.csrfToken)
          .send({ title: 'Alice private note', content: 'secret' })
          .expect(200)
      ).body as NoteSummaryBody;

      await importAs(bob, { files: vault, dryRun: false, targetParentId: aliceNote.id }).expect(
        404,
      );
      await importAs(bob, { files: vault, dryRun: true, targetParentId: aliceNote.id }).expect(404);

      expect(await notesOf(bob)).toEqual([]);
      expect((await notesOf(alice)).map((note) => note.id)).toEqual([aliceNote.id]);
    });

    it("A cannot see B's imported notes", async () => {
      const res = await importAs(bob, { files: vault, dryRun: false }).expect(200);

      await alice.agent.get(`/api/notes/${(res.body as ImportBody).rootNoteId}`).expect(404);
      expect(await notesOf(alice)).toEqual([]);
    });
  });

  describe('validation and limits', () => {
    it('rejects a request without the CSRF token with 403, before reading a large body', async () => {
      await alice.agent
        .post('/api/notes/import')
        .send({ files: [{ path: 'a.md', content: 'x'.repeat(26 * 1024 * 1024) }], dryRun: true })
        .expect(403);
    });

    it('rejects a body over 25 MB with 413', async () => {
      await importAs(alice, {
        files: [{ path: 'a.md', content: 'x'.repeat(26 * 1024 * 1024) }],
        dryRun: true,
      }).expect(413);
    });

    it('accepts a body over 2 MB on the import route only', async () => {
      const content = 'x'.repeat(900_000);
      const files = [1, 2, 3].map((i) => ({ path: `big ${i}.md`, content }));

      await importAs(alice, { files, dryRun: true }).expect(200);
      await alice.agent
        .post('/api/notes')
        .set('X-CSRF-Token', alice.csrfToken)
        .send({ title: 'big', content: 'x'.repeat(3 * 1024 * 1024) })
        .expect(413);
    });

    it('rejects more than 2000 files with 400', async () => {
      const files = Array.from({ length: 2001 }, (_, i) => ({ path: `n${i}.md`, content: 'x' }));
      await importAs(alice, { files, dryRun: true }).expect(400);
    });

    it.each([
      ['an empty file list', { files: [], dryRun: true }],
      ['a missing dryRun', { files: [{ path: 'a.md', content: 'x' }] }],
      ['dryRun as a string', { files: [{ path: 'a.md', content: 'x' }], dryRun: 'false' }],
      ['an unknown mode', { files: [{ path: 'a.md', content: 'x' }], dryRun: true, mode: 'zip' }],
      [
        'a target that is not a UUID',
        { files: [{ path: 'a.md', content: 'x' }], dryRun: true, targetParentId: 'x' },
      ],
      [
        'split-h1 with two files',
        {
          files: [
            { path: 'a.md', content: 'x' },
            { path: 'b.md', content: 'y' },
          ],
          dryRun: true,
          mode: 'split-h1',
        },
      ],
      ['nothing importable', { files: [{ path: 'a.png', content: 'x' }], dryRun: false }],
    ])('rejects %s with 400', async (_case, body) => {
      await importAs(alice, body).expect(400);
    });

    it('requires a session', async () => {
      const anonymous = request.agent(app.getHttpServer());
      const csrf = await anonymous.get('/api/csrf-token').expect(200);

      await anonymous
        .post('/api/notes/import')
        .set('X-CSRF-Token', (csrf.body as { csrfToken: string }).csrfToken)
        .send({ files: [{ path: 'a.md', content: 'x' }], dryRun: true })
        .expect(401);
    });

    it('throttles the import route to 5 requests a minute', async () => {
      const body = { files: [{ path: 'a.md', content: 'x' }], dryRun: true };
      for (let i = 0; i < 5; i++) await importAs(alice, body).expect(200);
      await importAs(alice, body).expect(429);
    });
  });
});
