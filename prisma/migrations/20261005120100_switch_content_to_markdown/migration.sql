-- Switch: markdown becomes "content", the Tiptap JSON is kept as "content_legacy" for rollback.
-- Refuses to run while any row is missing its markdown, so no note can end up empty.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Note" WHERE "content_md" IS NULL)
    OR EXISTS (SELECT 1 FROM "NoteVersion" WHERE "content_md" IS NULL) THEN
    RAISE EXCEPTION 'content_md is not backfilled. Run "npm run db:backfill-content-md" first.';
  END IF;
END $$;

-- The FTS index depends on the JSONB column.
DROP INDEX IF EXISTS "note_content_fts_idx";

ALTER TABLE "Note" RENAME COLUMN "content" TO "content_legacy";
ALTER TABLE "Note" ALTER COLUMN "content_legacy" DROP NOT NULL;
ALTER TABLE "Note" RENAME COLUMN "content_md" TO "content";
ALTER TABLE "Note" ALTER COLUMN "content" SET NOT NULL;

ALTER TABLE "NoteVersion" RENAME COLUMN "content" TO "content_legacy";
ALTER TABLE "NoteVersion" ALTER COLUMN "content_legacy" DROP NOT NULL;
ALTER TABLE "NoteVersion" RENAME COLUMN "content_md" TO "content";
ALTER TABLE "NoteVersion" ALTER COLUMN "content" SET NOT NULL;

-- Full-text search on the markdown text (must match the expression in NotesPgRepository).
CREATE INDEX IF NOT EXISTS "note_content_fts_idx"
  ON "Note" USING GIN (to_tsvector('simple', "content"));
