-- Hybrid RAG search: keyword (full-text) search over note chunks, ignoring diacritics like
-- the note search (simple_unaccent). Must match the expression in RagRepository.keywordSearch.
-- No data changes.
--
-- Rollback (manual; first deploy code with RAG_HYBRID=false or without keywordSearch):
--   DROP INDEX IF EXISTS "NoteChunk_content_fts_idx";

CREATE INDEX "NoteChunk_content_fts_idx"
  ON "NoteChunk" USING GIN (to_tsvector('simple_unaccent', "headingPath" || ' ' || "content"));
