CREATE INDEX IF NOT EXISTS note_title_fts_idx
  ON "Note" USING GIN (to_tsvector('simple', coalesce("title", '')));
CREATE INDEX IF NOT EXISTS note_content_fts_idx
  ON "Note" USING GIN (to_tsvector('simple', coalesce("content", '')));