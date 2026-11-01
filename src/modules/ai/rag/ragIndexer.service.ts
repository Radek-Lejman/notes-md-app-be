import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EMBEDDING_PROVIDER, EmbeddingProvider, LlmProviderUnavailableError } from '@ai';
import { AI_MODULE_CONFIG, AiModuleConfig } from '../config/aiModule.config';
import { chunkMarkdown, embeddingText } from './chunkMarkdown';
import { RagRepository } from './rag.repository';
import { NoteToIndex } from './rag.types';

const EMBED_BATCH = 32;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60_000;
/** Pause between rounds while a backlog (e.g. a note import) is being drained. */
export const DRAIN_DELAY_MS = 250;

interface FailedNote {
  attempts: number;
  retryAt: number;
}

/**
 * Keeps note embeddings up to date in the background: every RAG_INDEX_INTERVAL_MS it
 * (re)indexes notes changed since their last indexing. No hooks in the notes module —
 * staleness is `ragIndexedAt < updatedAt`. After a full batch the next round starts almost
 * at once ("drain"), so a large import is indexed in minutes, not hours.
 */
@Injectable()
export class RagIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagIndexerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Provider unreachable in the last round (log once, not every round). */
  private unavailable = false;
  /** The last round fetched a full batch, so more notes are probably waiting. */
  private drainNext = false;
  /** Notes whose own indexing failed: retried with exponential backoff so they don't block others. */
  private readonly failedNotes = new Map<string, FailedNote>();

  constructor(
    @Inject(AI_MODULE_CONFIG) private readonly config: AiModuleConfig,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly repository: RagRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.rag.enabled) {
      this.logger.log('RAG disabled (RAG_ENABLED=false)');
      return;
    }
    try {
      const invalidated = await this.repository.invalidateOtherModels(this.embeddings.model);
      if (invalidated) this.logger.log(`Embedding model changed: re-indexing ${invalidated} notes`);
    } catch (e) {
      this.logger.error(`RAG init failed: ${(e as Error).message}`);
    }
    this.schedule(1_000);
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Indexes one batch of stale notes. Returns how many were indexed. */
  async indexPending(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const { indexBatchSize, indexDebounceMs } = this.config.rag;
      const notes = await this.repository.findNotesToIndex(
        indexBatchSize,
        new Date(Date.now() - indexDebounceMs),
        this.notesWaitingForRetry(),
      );
      // Counted on fetched notes, not successes: one failing note must not stop the drain.
      this.drainNext = notes.length >= indexBatchSize;

      let indexed = 0;
      for (const note of notes) {
        try {
          await this.indexNote(note);
          this.failedNotes.delete(note.id);
          indexed++;
        } catch (e) {
          // Provider down: stop the round, keep the notes as they are, retry next round.
          if (e instanceof LlmProviderUnavailableError) throw e;
          this.markFailed(note.id, e as Error);
        }
      }

      if (this.unavailable) this.logger.log('RAG indexing recovered');
      this.unavailable = false;
      if (indexed) this.logger.log(`Indexed ${indexed} note(s)`);
      return indexed;
    } catch (e) {
      // Typically Ollama not running / model not pulled: log once, retry next round.
      if (!this.unavailable) this.logger.warn(`RAG indexing paused: ${(e as Error).message}`);
      this.unavailable = true;
      this.drainNext = false;
      return 0;
    } finally {
      this.running = false;
    }
  }

  private notesWaitingForRetry(): string[] {
    const now = Date.now();
    return [...this.failedNotes].filter(([, f]) => f.retryAt > now).map(([id]) => id);
  }

  private markFailed(noteId: string, error: Error): void {
    const attempts = (this.failedNotes.get(noteId)?.attempts ?? 0) + 1;
    const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
    this.failedNotes.set(noteId, { attempts, retryAt: Date.now() + delay });
    this.logger.warn(
      `RAG indexing of note ${noteId} failed (attempt ${attempts}, retry in ${delay / 1000}s): ` +
        error.message,
    );
  }

  private async indexNote(note: NoteToIndex): Promise<void> {
    const drafts = chunkMarkdown(note.title, note.content, this.config.rag);
    const vectors: number[][] = [];
    for (let i = 0; i < drafts.length; i += EMBED_BATCH) {
      const batch = drafts.slice(i, i + EMBED_BATCH).map(embeddingText);
      vectors.push(...(await this.embeddings.embed(batch)));
    }

    await this.repository.replaceChunks(
      note,
      this.embeddings.model,
      drafts.map((draft, i) => ({ ...draft, embedding: vectors[i] })),
    );
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.indexPending().finally(() => {
        if (this.timer) {
          this.schedule(this.drainNext ? DRAIN_DELAY_MS : this.config.rag.indexIntervalMs);
        }
      });
    }, delayMs);
    this.timer.unref();
  }
}
