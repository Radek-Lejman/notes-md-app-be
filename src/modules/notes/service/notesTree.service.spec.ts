import { NotesTreeService } from './notesTree.service';
import { NotesService } from './notes.service';
import { GetNoteQueryDto } from '../dto/getNoteQuery.dto';

describe('NotesTreeService default fields', () => {
  const getNoteById = jest.fn<Promise<unknown>, Parameters<NotesService['getNoteById']>>();
  const getNoteByParentId = jest.fn<
    Promise<unknown>,
    Parameters<NotesService['getNoteByParentId']>
  >();
  const service = new NotesTreeService({
    getNoteById,
    getNoteByParentId,
  } as unknown as NotesService);

  const query = (overrides: Partial<GetNoteQueryDto> = {}) =>
    Object.assign(new GetNoteQueryDto(), { depth: 1, ...overrides });

  beforeEach(() => {
    getNoteById.mockReset().mockResolvedValue({ id: 'root', parentId: null, title: 'Root' });
    getNoteByParentId.mockReset().mockResolvedValue([]);
  });

  it('loads the requested note with its markdown content', async () => {
    await service.getNoteWithFamily('root', query(), 'u1');
    expect(getNoteById.mock.calls[0][1]).toMatchObject({ content: true, title: true });
  });

  it('lists children without their content', async () => {
    await service.getNoteWithFamily('root', query(), 'u1');

    const childrenSelector = getNoteByParentId.mock.calls[0][1];
    expect(childrenSelector).toMatchObject({ id: true, title: true, parentId: true });
    expect(childrenSelector).not.toHaveProperty('content');
  });

  it('still returns children content when explicitly requested', async () => {
    await service.getNoteWithFamily('root', query({ 'children.fields': 'title,content' }), 'u1');
    expect(getNoteByParentId.mock.calls[0][1]).toMatchObject({ content: true });
  });
});

describe('NotesTreeService tree loading', () => {
  type Row = { id: string; parentId: string | null; title?: string };
  const getNoteById = jest.fn<Promise<Row | null>, Parameters<NotesService['getNoteById']>>();
  const getNoteByParentId = jest.fn<
    Promise<Row[]>,
    Parameters<NotesService['getNoteByParentId']>
  >();
  const service = new NotesTreeService({
    getNoteById,
    getNoteByParentId,
  } as unknown as NotesService);

  const query = (overrides: Partial<GetNoteQueryDto> = {}) =>
    Object.assign(new GetNoteQueryDto(), overrides);

  /** Children by parent id, served like the database would for `parentId IN (...)`. */
  const serveChildren = (byParent: Record<string, Row[]>) =>
    getNoteByParentId.mockImplementation((parentIds) =>
      Promise.resolve(parentIds.flatMap((id) => byParent[id] ?? [])),
    );

  beforeEach(() => {
    getNoteById.mockReset().mockResolvedValue({ id: 'root', parentId: 'p0', title: 'Root' });
    getNoteByParentId.mockReset().mockResolvedValue([]);
  });

  it('returns null for a missing note or a note of another user', async () => {
    getNoteById.mockResolvedValue(null);

    await expect(service.getNoteWithFamily('root', query({ depth: 3 }), 'u2')).resolves.toBeNull();
    expect(getNoteByParentId).not.toHaveBeenCalled();
  });

  it('loads only the note itself at depth 0 (the default)', async () => {
    await expect(service.getNoteWithFamily('root', query(), 'u1')).resolves.toEqual({
      id: 'root',
      parentId: 'p0',
      title: 'Root',
      children: [],
      parent: undefined,
    });
    expect(getNoteByParentId).not.toHaveBeenCalled();
  });

  it('loads children level by level up to the requested depth, scoped to the user', async () => {
    serveChildren({
      root: [
        { id: 'a', parentId: 'root' },
        { id: 'b', parentId: 'root' },
      ],
      a: [{ id: 'a1', parentId: 'a' }],
      a1: [{ id: 'a1x', parentId: 'a1' }],
    });

    const result = await service.getNoteWithFamily('root', query({ depth: 2 }), 'u1');

    expect(getNoteByParentId.mock.calls.map(([ids, , , userId]) => [ids, userId])).toEqual([
      [['root'], 'u1'],
      [['a', 'b'], 'u1'],
    ]);
    expect(result?.children).toEqual([
      { id: 'a', parentId: 'root', children: [{ id: 'a1', parentId: 'a', children: [] }] },
      { id: 'b', parentId: 'root', children: [] },
    ]);
  });

  it('stops early when a level has no children', async () => {
    serveChildren({ root: [{ id: 'a', parentId: 'root' }] });

    await service.getNoteWithFamily('root', query({ depth: 10 }), 'u1');
    expect(getNoteByParentId).toHaveBeenCalledTimes(2);
  });

  it('caps the depth at 10 levels', async () => {
    const chain: Record<string, Row[]> = {};
    let parent = 'root';
    for (let i = 0; i < 15; i++) {
      chain[parent] = [{ id: `n${i}`, parentId: parent }];
      parent = `n${i}`;
    }
    serveChildren(chain);

    await service.getNoteWithFamily('root', query({ depth: 50 }), 'u1');
    expect(getNoteByParentId).toHaveBeenCalledTimes(10);
  });

  it('returns at most children.limit children per parent', async () => {
    serveChildren({
      root: [
        { id: 'a', parentId: 'root' },
        { id: 'b', parentId: 'root' },
        { id: 'c', parentId: 'root' },
      ],
      a: [
        { id: 'a1', parentId: 'a' },
        { id: 'a2', parentId: 'a' },
        { id: 'a3', parentId: 'a' },
      ],
    });

    const result = await service.getNoteWithFamily(
      'root',
      query({ depth: 2, 'children.limit': 2 }),
      'u1',
    );

    expect(result?.children?.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result?.children?.[0].children?.map((c) => c.id)).toEqual(['a1', 'a2']);
    // Children of dropped notes are not loaded.
    expect(getNoteByParentId.mock.calls[1][0]).toEqual(['a', 'b']);
  });

  it('skips a child without a parent reference', async () => {
    serveChildren({
      root: [
        { id: 'orphan', parentId: null },
        { id: 'a', parentId: 'root' },
      ],
    });

    const result = await service.getNoteWithFamily('root', query({ depth: 1 }), 'u1');
    expect(result?.children?.map((c) => c.id)).toEqual(['a']);
  });

  it.each([
    [undefined, { createdAt: 'asc' }],
    ['-updatedAt', { updatedAt: 'desc' }],
  ] as const)('orders children by %s', async (sort, orderBy) => {
    await service.getNoteWithFamily('root', query({ depth: 1, 'children.sort': sort }), 'u1');
    expect(getNoteByParentId.mock.calls[0][2]).toEqual(orderBy);
  });

  it('uses the root fields for children when children.fields is not given', async () => {
    await service.getNoteWithFamily('root', query({ depth: 1, fields: 'title' }), 'u1');

    expect(getNoteById.mock.calls[0][1]).toEqual({ title: true });
    expect(getNoteByParentId.mock.calls[0][1]).toEqual({ title: true });
  });

  describe('expand=parent', () => {
    it('adds the parent note, loaded for the same user', async () => {
      getNoteById.mockImplementation((id) =>
        Promise.resolve(
          id === 'root' ? { id: 'root', parentId: 'p0' } : { id: 'p0', parentId: null, title: 'P' },
        ),
      );

      const result = await service.getNoteWithFamily('root', query({ expand: 'parent' }), 'u1');

      expect(result?.parent).toEqual({ id: 'p0', parentId: null, title: 'P' });
      expect(getNoteById).toHaveBeenLastCalledWith('p0', expect.any(Object), 'u1');
    });

    it('leaves parent undefined for a top-level note', async () => {
      getNoteById.mockResolvedValue({ id: 'root', parentId: null });

      const result = await service.getNoteWithFamily('root', query({ expand: 'parent' }), 'u1');
      expect(result?.parent).toBeUndefined();
      expect(getNoteById).toHaveBeenCalledTimes(1);
    });

    it('leaves parent undefined when the parent is not visible to the user', async () => {
      getNoteById.mockResolvedValueOnce({ id: 'root', parentId: 'p0' }).mockResolvedValueOnce(null);

      const result = await service.getNoteWithFamily('root', query({ expand: 'parent' }), 'u1');
      expect(result?.parent).toBeUndefined();
    });

    it('does not load the parent unless asked', async () => {
      await service.getNoteWithFamily('root', query(), 'u1');
      expect(getNoteById).toHaveBeenCalledTimes(1);
    });
  });
});
