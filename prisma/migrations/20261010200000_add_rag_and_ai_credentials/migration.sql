-- RAG (pgvector) + per-user AI credentials.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Note" ADD COLUMN "ragIndexedAt" TIMESTAMP(3);

-- No fixed dimension: the embedding model is configurable (RAG_EMBEDDING_MODEL) and rows of
-- other models are re-indexed. Exact search per user is fast for personal-size collections;
-- add an HNSW index on (embedding::vector(N)) if it ever grows to 100k+ chunks.
CREATE TABLE "NoteChunk" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "headingPath" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NoteChunk_userId_model_idx" ON "NoteChunk"("userId", "model");
CREATE INDEX "NoteChunk_noteId_idx" ON "NoteChunk"("noteId");

ALTER TABLE "NoteChunk" ADD CONSTRAINT "NoteChunk_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiCredential" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCredential_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "AiCredential" ADD CONSTRAINT "AiCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
