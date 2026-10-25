import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/database/prisma/prisma.service';
import { isPrismaKnownError } from '@database/prisma';
import { MAX_IMPORT_TOTAL_BYTES } from '../consts/import.consts';
import { ImportNotesDto, ImportResult } from '../dto/importNotes.dto';
import { ImportPlanError, planImport } from '../import/planImport';
import { NotesService } from './notes.service';

export const IMPORT_BATCH_SIZE = 500;
export const IMPORT_TRANSACTION_TIMEOUT_MS = 60_000;

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
}

/** Known database errors as readable 4xx; anything else stays a 500. */
function rethrowImportError(err: unknown): never {
  if (isPrismaKnownError(err)) {
    // The target note was deleted between the owner check and the insert.
    if (err.code === 'P2003') throw new NotFoundException('Note not found');
    if (err.code === 'P2000' || err.code === 'P2007') {
      throw new BadRequestException('A note from the import could not be saved');
    }
  }
  throw err;
}

@Injectable()
export class NotesImportService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly notesService: NotesService,
  ) {}

  /**
   * Imports many markdown files as one note tree under a new root note, or only reports what an
   * import would do (`dryRun`). All or nothing. FTS indexes the rows on insert; RAG picks them
   * up in the background (`ragIndexedAt` is null).
   */
  async importNotes(
    dto: ImportNotesDto,
    userId: string,
    newId: () => string = randomUUID,
    now: Date = new Date(),
  ): Promise<ImportResult> {
    const totalBytes = dto.files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
    if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
      throw new BadRequestException(
        `The import is larger than ${MAX_IMPORT_TOTAL_BYTES / 1024 / 1024} MB`,
      );
    }

    if (dto.targetParentId) await this.notesService.assertOwnedNote(dto.targetParentId, userId);

    let plan: ReturnType<typeof planImport>;
    try {
      plan = planImport(
        {
          files: dto.files,
          mode: dto.mode ?? 'files',
          rootTitle: dto.name?.trim() || `Import ${now.toISOString().slice(0, 10)}`,
        },
        newId,
      );
    } catch (err) {
      if (err instanceof ImportPlanError) throw new BadRequestException(err.message);
      throw err;
    }

    if (dto.dryRun) return { dryRun: true, rootNoteId: null, ...plan.report };

    if (plan.notes.length < 2) {
      throw new BadRequestException('Nothing to import: no file could be imported');
    }

    const base = now.getTime();
    await this.prismaService
      .$transaction(
        async (tx) => {
          // Parents come first in the plan, so every batch satisfies the parentId foreign key.
          for (const batch of chunk(plan.notes, IMPORT_BATCH_SIZE)) {
            await tx.note.createMany({
              data: batch.map((note) => {
                // No order column: children sort by createdAt, so it encodes the sibling order.
                const createdAt = new Date(base + note.order);
                return {
                  id: note.id,
                  userId,
                  parentId: note.parentId ?? dto.targetParentId ?? null,
                  title: note.title,
                  content: note.content,
                  createdAt,
                  updatedAt: createdAt,
                };
              }),
            });
          }
        },
        { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
      )
      .catch(rethrowImportError);

    return { dryRun: false, rootNoteId: plan.notes[0].id, ...plan.report };
  }
}
