/**
 * The eval user's index for scripts/rag-eval.ts: the vault imported into a dedicated user and
 * embedded. Reused across runs while the vault and the index settings are unchanged
 * (eval-runs/.cache/index.json), so search-time settings (min score, top k, hybrid) can be
 * compared in seconds and every run queries the same chunks.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { INestApplicationContext } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { PrismaService } from '../../src/infrastructure/database/prisma/prisma.service';
import { noteIdsByPath } from '../../src/modules/ai/rag/eval/dataset/goldMapping';
import {
  IndexCache,
  indexFingerprint,
  IndexSettings,
  readIndexCache,
  writeIndexCache,
} from '../../src/modules/ai/rag/eval/run/indexCache';
import { DRAIN_DELAY_MS, RagIndexerService } from '../../src/modules/ai/rag/ragIndexer.service';
import { RagSearchService } from '../../src/modules/ai/rag/ragSearch.service';
import { ImportNotesDto } from '../../src/modules/notes/dto/importNotes.dto';
import { ImportFileInput, IMPORT_MODE } from '../../src/modules/notes/import/importPlan.types';
import { planImport } from '../../src/modules/notes/import/planImport';
import { NotesImportService } from '../../src/modules/notes/service/notesImport.service';

const CACHE_FILE = join(__dirname, '../../eval-runs/.cache/index.json');
// `.invalid` never resolves; the password is not a bcrypt hash, so nobody can log in as it.
const EVAL_EMAIL = 'rag-eval@local.invalid';
const UNUSABLE_PASSWORD = '!';
const EVAL_IMPORT_NAME = 'RAG eval vault';
/** A vault of a few hundred notes indexes in minutes; longer means a note keeps failing. */
const INDEX_TIMEOUT_MS = 15 * 60_000;

export interface EvalIndex {
  userId: string;
  idByPath: Map<string, string>;
  reused: boolean;
  /** Identifies the chunks and embeddings a run queried (recorded with the run). */
  fingerprint: string;
}

/** The same ids for every call of the returned factory: the plan's ids are the saved notes' ids. */
function replayableIds() {
  const ids: string[] = [];
  return () => {
    let next = 0;
    return () => (ids[next++] ??= randomUUID());
  };
}

/** Through the DTO, so the content gets the same normalization as an HTTP import. */
async function toImportDto(files: ImportFileInput[]): Promise<ImportNotesDto> {
  const dto = plainToInstance(ImportNotesDto, {
    files,
    dryRun: false,
    name: EVAL_IMPORT_NAME,
  });
  await validateOrReject(dto);
  return dto;
}

/** The cached import if it was made from the same vault and settings and is still in the DB. */
async function reusableCache(
  prisma: PrismaService,
  fingerprint: string,
): Promise<IndexCache | null> {
  const cache = await readIndexCache(CACHE_FILE);
  if (cache?.fingerprint !== fingerprint) return null;

  const ids = Object.values(cache.idByPath);
  const [total, cached] = await Promise.all([
    prisma.note.count({ where: { userId: cache.userId } }),
    prisma.note.count({ where: { userId: cache.userId, id: { in: ids } } }),
  ]);
  return total === cache.noteCount && cached === ids.length ? cache : null;
}

/** Wipes the eval user's notes and imports the vault the way POST /notes/import would. */
async function importVault(
  app: INestApplicationContext,
  dto: ImportNotesDto,
): Promise<Omit<IndexCache, 'fingerprint'>> {
  const prisma = app.get(PrismaService);
  const user = await prisma.user.upsert({
    where: { email: EVAL_EMAIL },
    create: { email: EVAL_EMAIL, password: UNUSABLE_PASSWORD },
    update: {},
  });
  await prisma.$transaction([
    prisma.noteVersion.deleteMany({ where: { note: { userId: user.id } } }),
    prisma.note.deleteMany({ where: { userId: user.id } }),
  ]);

  const ids = replayableIds();
  const plan = planImport(
    { files: dto.files, mode: IMPORT_MODE.files, rootTitle: EVAL_IMPORT_NAME },
    ids(),
  );
  await app.get(NotesImportService).importNotes(dto, user.id, ids());
  return {
    userId: user.id,
    noteCount: plan.notes.length,
    idByPath: Object.fromEntries(noteIdsByPath(plan.notes)),
  };
}

/** Drains the indexer until every note of the user is embedded (a no-op when it already is). */
async function indexAll(app: INestApplicationContext, userId: string): Promise<void> {
  const indexer = app.get(RagIndexerService);
  const search = app.get(RagSearchService);
  const deadline = Date.now() + INDEX_TIMEOUT_MS;
  for (;;) {
    const { totalNotes, indexedNotes } = await search.stats(userId);
    process.stdout.write(`\rindexing ${indexedNotes}/${totalNotes} notes`);
    if (indexedNotes >= totalNotes) break;
    if (Date.now() > deadline) throw new Error('Indexing timed out (see the indexer warnings)');
    // 0 = nothing ready yet or the background round holds the lock; wait one drain step.
    if ((await indexer.indexPending()) === 0) {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_DELAY_MS));
    }
  }
  process.stdout.write('\n');
}

/** Reuses the cached import when the fingerprint matches, else re-imports; then indexes. */
export async function prepareEvalIndex(
  app: INestApplicationContext,
  options: { files: ImportFileInput[]; settings: IndexSettings; reindex: boolean },
): Promise<EvalIndex> {
  const dto = await toImportDto(options.files);
  const fingerprint = indexFingerprint(dto.files, options.settings);
  const reusable = options.reindex
    ? null
    : await reusableCache(app.get(PrismaService), fingerprint);

  let cache = reusable;
  if (!cache) {
    cache = { fingerprint, ...(await importVault(app, dto)) };
    await writeIndexCache(CACHE_FILE, cache);
  }
  await indexAll(app, cache.userId);

  return {
    userId: cache.userId,
    idByPath: new Map(Object.entries(cache.idByPath)),
    reused: reusable !== null,
    fingerprint: cache.fingerprint,
  };
}
