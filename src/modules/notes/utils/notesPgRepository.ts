import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma';

@Injectable()
export class NotesPgRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** `tsQuery` must come from `toTsQuery()`: `to_tsquery` syntax with `:*` prefixes. */
  async searchNotesDb(userId: string, tsQuery: string) {
    return await this.prismaService.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Note"
            WHERE "userId" = ${userId}
            AND (
                to_tsvector('simple', coalesce("title", '')) @@ to_tsquery('simple', ${tsQuery})
                OR
                to_tsvector('simple', "content") @@ to_tsquery('simple', ${tsQuery})
            )
        `;
  }
}
