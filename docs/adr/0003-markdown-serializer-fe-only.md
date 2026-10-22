# 0003 — The markdown serializer lives only in the FE

Status: **accepted** (2026-10-18, implemented in `0ee4ca9`, migration `20261018230000`) · supersedes part of [0001](./0001-markdown-as-note-content.md)

## Context

ADR 0001 kept two identical copies of the Tiptap ↔ markdown rules (BE and FE), synchronized by golden fixtures, plus a legacy `content_legacy` JSON column and a backfill script for rollback. The BE copy was only needed by the one-off JSON → markdown backfill. No environment holds Tiptap JSON any more (`content_legacy` verified `NULL` everywhere).

## Decision

- The serializer and its golden fixtures live **only in the FE** (`src/shared/lib/editor/markdown/`). The BE stores and searches markdown as plain text.
- Removed from the BE: `scripts/backfill-content-md.ts`, the Tiptap converters, the BE serializer copy and fixtures, the `migrator` backfill step in `docker-compose.yaml`, the `@tiptap/*` dependencies and overrides.
- Migration `20261018230000` drops `content_legacy` from `Note` and `NoteVersion`; it refuses to run if any value is left and documents how to re-add the columns.

## Alternatives

- **Keep the BE copy for future server-side rendering** — dead code with a sync cost until such a feature exists; it can be brought back from git history.

## Consequences

- One copy of the rules, no cross-repo fixture sync; an editor extension only needs an FE rule and fixture.
- Any future BE feature that must understand editor-specific markdown (e.g. page references) has to parse markdown itself or get a shared package.
- Rollback to Tiptap JSON is no longer possible without restoring the dropped columns and data from a backup.
- Production `npm audit`: 27 → 2 findings after dropping `@tiptap/*`.
