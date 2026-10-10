-- Expand: room for the markdown version of every note, filled by `npm run db:backfill-content-md`.
-- IF NOT EXISTS: the backfill script may have created the column already (it runs before deploy).
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "content_md" TEXT;
ALTER TABLE "NoteVersion" ADD COLUMN IF NOT EXISTS "content_md" TEXT;
