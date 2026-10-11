import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // The pre-markdown JSON stays in the database for rollback only; never load it.
    // ragIndexedAt is RAG bookkeeping, read only via raw SQL; keep it out of API responses.
    super({
      omit: {
        note: { contentLegacy: true, ragIndexedAt: true },
        noteVersion: { contentLegacy: true },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
