-- Drop the pre-markdown Tiptap JSON kept for rollback of the markdown switch (2026-10-05).
-- Verified empty (no non-NULL values) in every existing database before this migration;
-- the backfill script and Tiptap conversion code are removed together with it.
--
-- Rollback (restores the empty columns only; the data was already NULL):
--   ALTER TABLE "Note" ADD COLUMN "content_legacy" JSONB;
--   ALTER TABLE "NoteVersion" ADD COLUMN "content_legacy" JSONB;

-- Refuse to run if any legacy content is left, so no note data can be lost.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Note" WHERE "content_legacy" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "NoteVersion" WHERE "content_legacy" IS NOT NULL) THEN
    RAISE EXCEPTION 'content_legacy still holds data; back it up and clear it before dropping.';
  END IF;
END $$;

ALTER TABLE "Note" DROP COLUMN "content_legacy";
ALTER TABLE "NoteVersion" DROP COLUMN "content_legacy";
