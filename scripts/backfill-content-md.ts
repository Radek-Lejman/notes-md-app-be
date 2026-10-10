/**
 * Markdown migration, step between the two schema migrations:
 *   20261005120000_add_content_md            (expand: adds content_md)
 *   -> this script                           (fills content_md from the Tiptap JSON, verifies it)
 *   20261005120100_switch_content_to_markdown (content_md becomes content)
 *
 * Runs before `prisma migrate deploy` (see docker-compose migrator), so it is safe in any state:
 * - fresh database (no "Note" table)        -> nothing to do
 * - already switched ("content" is text)    -> nothing to do
 * - "content" still JSONB                   -> creates content_md if needed, fills and verifies it
 *
 * Exits with 1 when a note cannot be converted or loses words, so the switch never runs on bad
 * data. Set BACKFILL_ALLOW_MISMATCH=1 to accept reported word differences after reviewing them.
 *
 * Usage: npm run db:backfill-content-md
 */
import { PrismaClient } from '@prisma/client';
import {
  backfillContentMd,
  BackfillDelegate,
  BackfillRow,
  toTiptapDoc,
} from '../src/modules/notes/migration/backfillContentMd';
import { compareContent } from '../src/modules/notes/migration/contentMdVerify';

const prisma = new PrismaClient();
const TABLES = { note: 'Note', noteVersion: 'NoteVersion' } as const;
const BATCH = 500;

type VerifyRow = BackfillRow & { content_md: string | null };

async function contentColumnType(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ data_type: string }[]>`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Note' AND column_name = 'content'`;
  return rows[0]?.data_type ?? null;
}

// Raw SQL: the generated client already describes the post-migration schema.
const delegate = (table: string): BackfillDelegate => ({
  findMany: ({ take, cursor }) =>
    cursor
      ? prisma.$queryRawUnsafe<BackfillRow[]>(
          `SELECT id, content FROM "${table}" WHERE id > $1 ORDER BY id ASC LIMIT $2`,
          cursor.id,
          take,
        )
      : prisma.$queryRawUnsafe<BackfillRow[]>(
          `SELECT id, content FROM "${table}" ORDER BY id ASC LIMIT $1`,
          take,
        ),
  update: ({ where, data }) =>
    prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET content_md = $1 WHERE id = $2`,
      data.contentMd,
      where.id,
    ),
});

async function verify(table: string): Promise<{ id: string; missing: string[] }[]> {
  const mismatches: { id: string; missing: string[] }[] = [];
  let lastId = '';

  for (;;) {
    const rows = await prisma.$queryRawUnsafe<VerifyRow[]>(
      `SELECT id, content, content_md FROM "${table}" WHERE id > $1 ORDER BY id ASC LIMIT $2`,
      lastId,
      BATCH,
    );
    for (const row of rows) {
      const { ok, missing } = compareContent(toTiptapDoc(row.content), row.content_md ?? '');
      if (!ok) mismatches.push({ id: row.id, missing });
    }
    if (rows.length < BATCH) return mismatches;
    lastId = rows[rows.length - 1].id;
  }
}

async function main(): Promise<number> {
  const columnType = await contentColumnType();
  if (columnType === null) {
    console.log('No "Note" table yet (fresh database) - nothing to backfill.');
    return 0;
  }
  if (columnType !== 'jsonb') {
    console.log(`"Note"."content" is ${columnType} - already migrated to markdown.`);
    return 0;
  }

  for (const table of Object.values(TABLES)) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS content_md TEXT`,
    );
  }

  const report = await backfillContentMd(
    { note: delegate(TABLES.note), noteVersion: delegate(TABLES.noteVersion) },
    { batchSize: BATCH },
  );
  console.log(`Converted ${report.processed} rows to markdown.`);
  if (Object.keys(report.droppedMarks).length > 0) {
    console.log('Formatting markdown cannot express (text kept):', report.droppedMarks);
  }
  if (Object.keys(report.unknownNodes).length > 0) {
    console.log('Unknown blocks unwrapped (text kept):', report.unknownNodes);
  }
  if (report.failed.length > 0) {
    console.error('Rows that could not be converted:', report.failed);
    return 1;
  }

  const mismatches = [
    ...(await verify(TABLES.note)).map((m) => ({ table: TABLES.note, ...m })),
    ...(await verify(TABLES.noteVersion)).map((m) => ({ table: TABLES.noteVersion, ...m })),
  ];
  if (mismatches.length === 0) {
    console.log('Verified: no words were lost.');
    return 0;
  }

  console.error('Rows whose markdown lost words (compare content and content_md):', mismatches);
  if (process.env.BACKFILL_ALLOW_MISMATCH === '1') {
    console.warn('BACKFILL_ALLOW_MISMATCH=1 - continuing anyway.');
    return 0;
  }
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
