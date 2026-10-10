import { Note as PrismaNote } from '@prisma/client';
import { NoteMapper } from './note.mapper';

const createdAt = new Date('2026-01-01');
const updatedAt = new Date('2026-01-02');

const prismaNote = {
  id: 'n1',
  title: 'Docker',
  content: '# Docker\n\nNotatki o **kontenerach**.',
  createdAt,
  updatedAt,
  userId: 'u1',
  parentId: null,
} as PrismaNote;

describe('NoteMapper', () => {
  describe('toDomain', () => {
    it('passes markdown content through unchanged', () => {
      expect(NoteMapper.toDomain(prismaNote)).toEqual(prismaNote);
    });

    it('keeps empty content as an empty string', () => {
      expect(NoteMapper.toDomain({ ...prismaNote, content: '' })?.content).toBe('');
    });

    it('returns null for a missing note', () => {
      expect(NoteMapper.toDomain(null)).toBeNull();
    });
  });

  describe('toDomainList', () => {
    it('maps every note', () => {
      const other = { ...prismaNote, id: 'n2' };
      expect(NoteMapper.toDomainList([prismaNote, other])).toEqual([prismaNote, other]);
    });

    it('returns an empty list for no notes', () => {
      expect(NoteMapper.toDomainList([])).toEqual([]);
    });
  });

  describe('toPersistenceCreate', () => {
    it('stores markdown as-is and connects the owner', () => {
      expect(NoteMapper.toPersistenceCreate({ title: 'T', content: '# T' }, 'u1')).toEqual({
        title: 'T',
        content: '# T',
        user: { connect: { id: 'u1' } },
      });
    });

    it('connects the parent when given', () => {
      expect(
        NoteMapper.toPersistenceCreate({ title: 'T', content: '', parentId: 'p1' }, 'u1'),
      ).toMatchObject({ content: '', parent: { connect: { id: 'p1' } } });
    });
  });

  describe('toPersistenceUpdate', () => {
    it('omits content when only the title changes', () => {
      expect(NoteMapper.toPersistenceUpdate({ title: 'Nowy' })).toEqual({ title: 'Nowy' });
    });

    it('stores markdown content as-is', () => {
      expect(NoteMapper.toPersistenceUpdate({ content: '- a\n- b' })).toEqual({
        content: '- a\n- b',
      });
    });

    it('treats empty content as a value, not as "no change"', () => {
      expect(NoteMapper.toPersistenceUpdate({ content: '' })).toEqual({ content: '' });
    });

    it('disconnects the parent for parentId null', () => {
      expect(NoteMapper.toPersistenceUpdate({ parentId: null })).toEqual({
        parent: { disconnect: true },
      });
    });

    it('connects a new parent', () => {
      expect(NoteMapper.toPersistenceUpdate({ parentId: 'p2' })).toEqual({
        parent: { connect: { id: 'p2' } },
      });
    });
  });
});
