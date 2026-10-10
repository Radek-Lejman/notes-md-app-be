/*
  Warnings:

  - Changed the type of `content` on the `Note` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `content` on the `NoteVersion` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- Drop the existing FTS index that depends on 'content' being text
DROP INDEX IF EXISTS "note_content_fts_idx";

-- AlterTable
ALTER TABLE "Note" ALTER COLUMN "content" TYPE JSONB USING "content"::jsonb;

-- AlterTable
ALTER TABLE "NoteVersion" ALTER COLUMN "content" TYPE JSONB USING "content"::jsonb;

-- Recreate the FTS index for the new JSONB 'content' column
CREATE INDEX IF NOT EXISTS "note_content_fts_idx"
  ON "Note" USING GIN (to_tsvector('simple', "content"));
