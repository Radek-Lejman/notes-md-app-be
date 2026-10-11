import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma';
import { EmbeddedChunk, NoteToIndex, RagHit, RagIndexStats } from './rag.types';

/** pgvector literal from numbers only — never from user input. */
export function toVectorLiteral(vector: number[]): string {
  if (!vector.length || !vector.every(Number.isFinite)) {
    throw new Error('Invalid embedding vector');
  }
  return `[${vector.join(',')}]`;
}

/**
 * A JS Date as the UTC `timestamp` Prisma stores in its (timezone-less) DateTime columns.
 * Binding a Date directly makes Postgres convert through the session time zone, so equality
 * and range checks against those columns break when the database is not on UTC.
 */
export function utcTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** Raw SQL for the RAG tables (Prisma has no vector type). All queries are parameterized. */
@Injectable()
export class RagRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Notes never indexed or edited since, untouched for the debounce period,
   * skipping `excludeIds` (notes waiting to retry after a failure).
   */
  findNotesToIndex(
    limit: number,
    editedBefore: Date,
    excludeIds: string[] = [],
  ): Promise<NoteToIndex[]> {
    return this.prisma.$queryRaw<NoteToIndex[]>`
      SELECT "id", "userId", "title", "content", "updatedAt"
      FROM "Note"
      WHERE ("ragIndexedAt" IS NULL OR "ragIndexedAt" < "updatedAt")
        AND "updatedAt" < ${utcTimestamp(editedBefore)}
        AND NOT ("id" = ANY(${excludeIds}::text[]))
      ORDER BY "updatedAt" ASC
      LIMIT ${limit}`;
  }

  /**
   * Swaps the note's chunks and marks the indexed version. If the note was edited meanwhile,
   * `updatedAt` no longer matches, so it stays stale and is indexed again next round.
   */
  async replaceChunks(note: NoteToIndex, model: string, chunks: EmbeddedChunk[]): Promise<void> {
    const inserts = chunks.map(
      (chunk, index) => this.prisma.$executeRaw`
        INSERT INTO "NoteChunk"
          ("id", "noteId", "userId", "chunkIndex", "headingPath", "content", "model", "embedding")
        VALUES (gen_random_uuid()::text, ${note.id}, ${note.userId}, ${index},
          ${chunk.headingPath}, ${chunk.content}, ${model},
          ${toVectorLiteral(chunk.embedding)}::vector)`,
    );

    await this.prisma.$transaction([
      this.prisma.$executeRaw`DELETE FROM "NoteChunk" WHERE "noteId" = ${note.id}`,
      ...inserts,
      this.prisma.$executeRaw`
        UPDATE "Note" SET "ragIndexedAt" = "updatedAt"
        WHERE "id" = ${note.id} AND "updatedAt" = ${utcTimestamp(note.updatedAt)}`,
    ]);
  }

  /** After switching RAG_EMBEDDING_MODEL: re-index notes embedded with another model. */
  invalidateOtherModels(model: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Note" SET "ragIndexedAt" = NULL
      WHERE "id" IN (SELECT DISTINCT "noteId" FROM "NoteChunk" WHERE "model" <> ${model})`;
  }

  /** Nearest chunks of ONE user's notes (exact cosine search). */
  search(userId: string, model: string, vector: number[], limit: number): Promise<RagHit[]> {
    const literal = toVectorLiteral(vector);
    return this.prisma.$queryRaw<RagHit[]>`
      SELECT c."noteId", n."title", c."headingPath", c."content",
        (1 - (c."embedding" <=> ${literal}::vector))::float8 AS "score"
      FROM "NoteChunk" c
      JOIN "Note" n ON n."id" = c."noteId" AND n."userId" = ${userId}
      WHERE c."userId" = ${userId}
        AND c."model" = ${model}
        AND vector_dims(c."embedding") = ${vector.length}
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${limit}`;
  }

  async stats(userId: string, model: string): Promise<RagIndexStats> {
    const [row] = await this.prisma.$queryRaw<
      { totalNotes: bigint; indexedNotes: bigint; chunks: bigint }[]
    >(Prisma.sql`
      SELECT
        (SELECT count(*) FROM "Note" WHERE "userId" = ${userId}) AS "totalNotes",
        (SELECT count(*) FROM "Note" WHERE "userId" = ${userId}
           AND "ragIndexedAt" >= "updatedAt") AS "indexedNotes",
        (SELECT count(*) FROM "NoteChunk" WHERE "userId" = ${userId}
           AND "model" = ${model}) AS "chunks"`);
    return {
      totalNotes: Number(row.totalNotes),
      indexedNotes: Number(row.indexedNotes),
      chunks: Number(row.chunks),
    };
  }
}
