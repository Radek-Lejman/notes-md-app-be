import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma";

@Injectable()
export class NotesPgRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async searchNotesDb(userId: string, q: string) {    
        return await this.prismaService.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Note"
            WHERE "userId" = ${userId}
            AND (
                to_tsvector('simple', coalesce("title", '')) @@ plainto_tsquery('simple', ${q})
                OR
                to_tsvector('simple', "content") @@ plainto_tsquery('simple', ${q})
            )
        `;
    }
}

