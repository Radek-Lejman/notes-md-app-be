-- Full-text search ignores Polish (and other) diacritics: "zolw" finds "Żółw" and vice versa.
-- A text search configuration = "simple" + the unaccent dictionary, used by both the indexes
-- and NotesPgRepository (the expressions must stay identical, or Postgres skips the index).
-- No data changes; only the two FTS indexes are rebuilt.
--
-- Rollback (manual; first deploy code where NotesPgRepository uses 'simple' again, otherwise
-- running instances fail with "text search configuration does not exist"):
--   DROP INDEX IF EXISTS "note_title_fts_idx";
--   DROP INDEX IF EXISTS "note_content_fts_idx";
--   CREATE INDEX "note_title_fts_idx" ON "Note" USING GIN (to_tsvector('simple', coalesce("title", '')));
--   CREATE INDEX "note_content_fts_idx" ON "Note" USING GIN (to_tsvector('simple', "content"));
--   DROP TEXT SEARCH CONFIGURATION IF EXISTS simple_unaccent;
--   (the unaccent extension can stay)

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TEXT SEARCH CONFIGURATION simple_unaccent (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION simple_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

DROP INDEX IF EXISTS "note_title_fts_idx";
DROP INDEX IF EXISTS "note_content_fts_idx";

CREATE INDEX "note_title_fts_idx"
  ON "Note" USING GIN (to_tsvector('simple_unaccent', coalesce("title", '')));
CREATE INDEX "note_content_fts_idx"
  ON "Note" USING GIN (to_tsvector('simple_unaccent', "content"));
