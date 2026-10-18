import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma';

@Injectable()
export class NotesPgRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * `tsQuery` must come from `toTsQuery()`: `to_tsquery` syntax with `:*` prefixes.
   * `simple_unaccent` ignores diacritics; the expressions must match the FTS indexes.
   * `rank`: relevance (ts_rank), a match in the title (weight A) counts more than in the
   * content (weight B).
   */
  async searchNotesDb(userId: string, tsQuery: string) {
    return await this.prismaService.$queryRaw<{ id: string; rank: number }[]>`
            SELECT id,
              ts_rank(
                setweight(to_tsvector('simple_unaccent', coalesce("title", '')), 'A')
                  || setweight(to_tsvector('simple_unaccent', "content"), 'B'),
                to_tsquery('simple_unaccent', ${tsQuery})
              )::float8 AS "rank"
            FROM "Note"
            WHERE "userId" = ${userId}
            AND (
                to_tsvector('simple_unaccent', coalesce("title", '')) @@ to_tsquery('simple_unaccent', ${tsQuery})
                OR
                to_tsvector('simple_unaccent', "content") @@ to_tsquery('simple_unaccent', ${tsQuery})
            )
        `;
  }
}
