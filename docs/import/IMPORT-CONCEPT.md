# Concept: importing a "second brain" (many markdown files)

Status: **proposal v2** (after review) · 2026-10-15 · concerns BE + FE

> Note (2026-10-22): since ADR 0003 the BE no longer has a copy of the markdown serializer (`markdownEscape.ts`, the Tiptap converter); references to it below need a BE-side replacement (e.g. a small local `escapeInline`) when this is implemented.

## 1. Goal

The user has notes from another system (Obsidian, Logseq, a Notion export, a plain `.md` folder)
and wants to pull them into the app once, so that they:

1. are **in the database** as regular notes (tree, editing, UI),
2. are **full-text searchable** (FTS),
3. are **in the vector store** (`NoteChunk`), so chat/agent can reach them via RAG,
4. keep their links (`[[Wiki link]]`, `[x](other.md)`) working as links to notes in the app.

## 2. What we already have and what follows from it

| Fact in the code | Consequence for import |
|---|---|
| `Note.content` is markdown, the single source of truth (ADR 0001) | A file goes into `content` almost 1:1, without a format conversion. |
| FTS = GIN indexes on the `to_tsvector('simple', …)` expression (`20251115_add_fts_indexes`, `20261005120100_…:25`), matching the queries in `notesPgRepository.ts` | **Nothing to do** — a row is searchable right after `INSERT`. |
| RAG: `RagIndexerService` indexes notes with `ragIndexedAt IS NULL OR < updatedAt`, older than the debounce | **Nothing needs calling** — new notes have `ragIndexedAt = NULL`. Problem: throughput (item 6). |
| Tree: `Note.parentId` (self-relation, no `onDelete`); **no order column** — children sorted only by `createdAt`, no tie-breaker (`core/sort/parseSort.ts`) | Folder structure → tree. Sibling order must be encoded in `createdAt` (item 5.4). |
| A note link = `[Title](/notes/<uuid>)`; a line consisting **only** of such a link = a `pageReference` block with a "frozen" title (fixture `04-page-reference.md`) | Wiki links are rewritten to this format → they work in the editor (item 5.3). |
| `CreateNoteDto`: title min. 2 characters, **no maximum**; content max 1,000,000 characters; BOM/CRLF normalization (a local function in `note.dto.ts`) | The same rules for import; `normalizeMarkdown` to be extracted into a shared util; a dedicated title length limit. |
| The editor (Tiptap, `createMarkdownExtensions`) has **no** tables or images; raw HTML passes through the schema | Tables, images and HTML from an import are invisible in the editor and **are lost on the first edit** (item 5.3). |
| JSON body limit `2mb`, set globally by `useBodyParser` (takes no path) | A larger limit for import = a separate parser mounted on the path (item 5.1). |
| No `DELETE /notes/:id` | "Undo import" needs separate work (item 10). |
| D14 (fixed in `f48577a`): `parent.connect` is narrowed to `{ id, userId }` and `P2025` maps to 404 | Import writes the scalar `parentId` through `createMany` (no `connect`), so it does **not** inherit that fix — `targetParentId` needs its own explicit owner check. |

Conclusion: import is in practice **"create N notes at once, with a tree and rewritten links"**.
FTS and RAG indexing are handled by existing mechanisms.

## 3. Scope

### MVP
- Input: a **folder** (`<input webkitdirectory>`), **many `.md` files** at once, or a **`.zip`**
  (an Obsidian/Notion export) — unpacked in the browser (item 7); the server gets the same `{ path, content }`.
- **"One file, split by H1"** mode (`split-h1`) — exactly one input file, each `# H1` = a separate note.
- Folder structure → a note tree under one import root note.
- YAML frontmatter: `title` → title; the whole block kept in the content as a ```yaml block.
- Links: `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[Folder/Note]]`, `![[Note]]`, `[text](relative/path.md)` → `/notes/<uuid>`.
- Preview (`dryRun`) before saving: number of notes, warnings, content that will be lost in the editor.
- Atomic save (all or nothing), errors mapped to 4xx with the file name.
- Faster RAG indexing ("drain" mode) + progress in the UI.

### Beyond MVP (phase 2)
- Attachments (images, PDFs) — no file storage; a warning today.
- Tables/images in the editor (Tiptap extensions — needs a change to the markdown rules + golden fixtures).
- `created`/`updated` dates from frontmatter; tags as a separate entity; `aliases` from frontmatter.
- Incremental import (update instead of duplicates), batched import for very large vaults.
- Logseq specifics (`- ` blocks, `prop:: value`); for Notion the MVP only strips the hash from the name.

## 4. Flow

```
FE: pick folder/files ─► read (File.text()) ─► POST /api/notes/import { dryRun: true, … }
                                                      │
                                                      ▼
                                   report: N notes, warnings, skipped files
                                                      │  the user clicks "Import"
                                                      ▼
                                   POST /api/notes/import { dryRun: false, … }  (same payload)
                                                      │
BE: 25mb parser (this path only) ─► CSRF ─► JWT ─► DTO ─► planImport() [pure functions]
    ─► createMany transaction ─► { rootNoteId, report }
                                                      │
                    FTS: immediately ◄────────────────┤
                    RAG: RagIndexer in the background (drain), progress from GET /api/ai/settings → rag.stats
```

Why the **browser** reads the files rather than the server (multipart/zip):
- no new BE dependency, no zip bombs and no temporary files on the server,
- the server does not touch the file system — paths are just strings,
- `webkitdirectory` provides `webkitRelativePath`, i.e. the folder structure without a zip.

Cost: a JSON payload of up to a dozen or so MB → a separate parser for this one route.

## 5. Backend

### 5.1 API (new contract — a change for the FE)

`POST /api/notes/import` (`@HttpCode(200)`)

```ts
// dto/importNotes.dto.ts
class ImportFileDto {
  @IsString() @MaxLength(1024) path: string;              // "Projects/Docker.md"
  @Transform(normalizeMarkdown) @IsString() @MaxLength(MAX_CONTENT_LENGTH) content: string;
}
class ImportNotesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_IMPORT_FILES)
  @ValidateNested({ each: true }) @Type(() => ImportFileDto) files: ImportFileDto[];
  @IsBoolean() dryRun: boolean;                           // in the body, not the query (no implicit conversion)
  @IsOptional() @IsString() @MaxLength(MAX_IMPORT_TITLE_LENGTH) name?: string; // default "Import 2026-10-15"
  @IsOptional() @IsUUID() targetParentId?: string;        // none = top level
  @IsOptional() @IsIn(['files', 'split-h1']) mode?: 'files' | 'split-h1';
}
```

Response:

```ts
interface ImportResult {
  dryRun: boolean;
  rootNoteId: string | null;            // null for dryRun
  created: number;                       // notes from files + folders + root
  skipped: { path: string; reason: 'not-markdown' | 'binary' | 'empty' | 'duplicate-path' | 'invalid-path' | 'hidden' }[];
  warnings: {
    path: string;
    kind:
      | 'unresolved-link' | 'ambiguous-link' | 'unsafe-link'
      | 'attachment-skipped' | 'lossy-content'      // table / image / HTML / footnote
      | 'title-fallback' | 'title-truncated';
    detail: string;                      // e.g. "[[Missing]]", "table"
  }[];
}
```

Limits (`consts/import.consts.ts`):
- `MAX_IMPORT_FILES = 2000`,
- `MAX_IMPORT_TOTAL_BYTES = 15 MB` — the sum of `Buffer.byteLength(content, 'utf8')`, checked in the service
  (`BadRequestException`), not in the pure `planImport`,
- `IMPORT_BODY_LIMIT = '25mb'` — derived from the above with headroom for JSON escaping (`\n`, `\"`) and paths,
  so a valid payload always gets a descriptive 400 rather than a 413,
- `MAX_IMPORT_TITLE_LENGTH = 200`,
- `@Throttle({ global: { ttl: ms('1m'), limit: 5 } })` (dryRun → fixes → dryRun → import).

**Body limit for this route only** (`configureApp`, before the global parser):

```ts
import { json } from 'express';
// Cheap checks before buffering a large body: no CSRF token → 403 before the body is read.
app.use('/api/notes/import', cookieParser(), csrfMiddleware, json({ limit: IMPORT_BODY_LIMIT }));
app.useBodyParser('json', { limit: '2mb' });
```

- `useBodyParser` takes no path (it mounts the parser globally), hence `app.use(path, …)`.
- The path must include `/api` — `setGlobalPrefix` does not apply to `app.use`.
- body-parser skips a request whose body has already been read, so the global 2mb parser is a no-op then.
- This middleware runs **before** the JWT guard — hence CSRF before the parser (csurf reads the token from a header).
  Remaining risk: a client, logged in or not, with a valid CSRF token can make the server parse 25 MB;
  acceptable with throttling, to be described in the PR.
- E2E: other routes still 413 above 2mb; import without CSRF → 403; import > 25mb → 413.

### 5.2 Modules and files

Pure functions (no Nest DI) in `src/modules/notes/import/`:

| File | Responsibility |
|---|---|
| `importPath.ts` | `normalizeImportPath(path)` → segments or a rejection reason: `normalize('NFC')`, `\` → `/`; rejects `..`, absolute paths (`/x`, `C:/x`), empty segments; hidden (`.obsidian/`, `.trash/`, `.DS_Store`) → `hidden`. `isMarkdownPath()` (`.md`, `.markdown`, case-insensitive). |
| `frontmatter.ts` | `splitFrontmatter(md)` → `{ frontmatter: string \| null, body }` (only when `---` is on the first line and closed); `readTitle(frontmatter)` — only a scalar `title:` (no YAML parser = no dependency). |
| `importTitle.ts` | Title from frontmatter or the file name: without the extension, without the Notion suffix (` <32 hex>`), trimmed; empty → folder name/"Untitled" (`title-fallback`); shorter than `MIN_CONTENT_LENGTH` → padded (`"A"` → `"A (import)"`, `title-fallback`); longer than `MAX_IMPORT_TITLE_LENGTH` → truncated (`title-truncated`). |
| `splitCombined.ts` | `splitByH1(md, fileName)` → virtual files; text before the first H1 → a note named after the file; `/` and `\` in an H1 replaced (so `CI/CD` does not create folders); duplicate titles → unique paths. |
| `buildImportTree.ts` | Paths → tree: folder = note. Folder note: `Folder/index.md` and `Folder.md` next to `Folder/` — merged into the folder's note. UUIDs assigned up front (injected `newId`). Sibling order: folders and files together, case-insensitive `localeCompare`. Output: a "parents before children" list. |
| `markdownScan.ts` | Iterates over the content skipping code blocks (``` and ~~~ matched by fence type and length, indented code blocks) and `` `code` `` spans. Shared by `resolveLinks`, `detectLossy`, `splitByH1`. |
| `resolveLinks.ts` | Target index (NFC-normalized path, basename) → id; rewrites links (item 5.3); neutralizes unsafe schemes. |
| `detectLossy.ts` | Detects GFM tables, images, raw HTML, footnotes → `lossy-content` warnings. |
| `planImport.ts` | Orchestration: **sorts the input by normalized path** (the browser's file order is not stable), filters, builds the tree, rewrites links → `ImportPlan { notes: PlannedNote[], report }`. Deterministic for a given `newId`. |

Service and controller:
- `service/notesImport.service.ts` — byte limit, `assertOwnedNote(targetParentId, userId)` (404), `planImport`,
  for `dryRun` only the report, otherwise the save (5.4).
- `assertOwnedNote` as a helper in `NotesService` (`findFirst({ where: { id, userId } })` → `NotFoundException`).
  D14 itself is already fixed for `createNote`/`updateNote` (`f48577a`); this helper exists because `createMany`
  takes a scalar `parentId` and bypasses that fix.
- `NotesController`: `@Post('import')`; `userId` only from `@CurrentUser()`.
- `normalizeMarkdown` extracted from `note.dto.ts` into a shared util.

### 5.3 Transformation rules

**Title**: `title` from frontmatter → file name (`importTitle.ts` rules). The note content is not changed for the title.

**Frontmatter** kept as a code block at the start of the content (including `title:`):

````md
```yaml
title: Docker
tags: [docker, devops]
```
````

Rationale: the editor's markdown parser reads `---\ntitle: X\n---` as a horizontal rule + a setext heading
`title: X` — the metadata would be mangled. A code block is lossless and visible to FTS/RAG.

**Resolving a link target** (paths and targets after `normalize('NFC')` — macOS produces file names in NFD):
1. a path relative to the source file (with or without `.md`),
2. a path from the import root,
3. a path suffix match (`[[Folder/Note]]`),
4. basename without the extension, case-insensitive (Obsidian style).

Several candidates → the shortest path, on a tie the lexicographically first; an `ambiguous-link` warning.

| Input | Result |
|---|---|
| `[[Docker]]` | `[Docker](/notes/<id>)` |
| `[[Docker\|containers]]` | `[containers](/notes/<id>)` |
| `[[Docker\\|containers]]` (in a table) | as above |
| `[[Docker#Networks]]`, `[[Docker#^block]]` | `[Docker › Networks](/notes/<id>)` / `[Docker](/notes/<id>)` — no anchors |
| `![[Docker]]` (the target is a note) | `[Docker](/notes/<id>)` (embed → link) |
| `[desc](../Infra/Docker.md)`, `[desc](My%20Note.md)`, `[desc](<My Note.md>)`, `[desc](Docker.md#networks)` | `[desc](/notes/<id>)` — `decodeURIComponent`, `<…>`, `#…` stripped |
| `![[diagram.png]]`, `![](img/a.png)` | unchanged + `attachment-skipped` |
| `[[No such note]]` | unchanged + `unresolved-link` |
| `[x](javascript:…)`, `[x](data:…)`, schemes other than http(s)/mailto/relative | just the text `x` + `unsafe-link` |
| `[x](https://…)`, links in code | unchanged |

Escaping: `escapeInline` (`markdown/markdownEscape.ts`) only for text coming from wiki links
(title, alias). The text of existing `[text](x.md)` links is already markdown — it is not escaped again.

**`pageReference` blocks**: a line consisting only of a note link becomes, in the editor, a block
with a "frozen" title (the link text). This applies to typical index notes (MOCs) with `[[A]]` on separate
lines. In `- [[A]]` and mid-sentence the link stays a regular link (it opens the note in the app). This
behaviour is intended, but needs a test (standalone line / list item / inline).

**Content is not canonicalized** by the Tiptap converter: we store the markdown as it came
(after BOM/CRLF normalization and link rewriting), so tables, images, HTML and footnotes are in the database, in FTS
and in RAG. **But**: the editor does not display them, and the first edit (autosave) **removes them from the note permanently**.
That is why `detectLossy` reports them in the `dryRun` report as `lossy-content`, and the FE needs a
follow-up task (a banner "this note contains elements the editor does not support" / read-only mode,
or Table/Image extensions).

### 5.4 Saving

```ts
const base = Date.now();
await prisma.$transaction(
  async (tx) => {
    for (const batch of chunk(plan.notes /* parents first */, 500)) {
      await tx.note.createMany({
        data: batch.map((n) => ({
          id: n.id, userId, parentId: n.parentId, title: n.title, content: n.content,
          // No order column: children sort by createdAt, so encode the planned sibling order.
          createdAt: new Date(base + n.order), updatedAt: new Date(base + n.order),
        })),
      });
    }
  },
  { timeout: 60_000 },
);
```

- `id` assigned up front → links rewritten **before** saving; one phase, no `UPDATE` afterwards.
- "Parents before children" → the `parentId` FK is satisfied in every batch.
- Every row's `userId` from the JWT; the root's `parentId` = the checked `targetParentId`; every other `parentId` is an id from the plan.
- `createdAt = base + order` → a stable order in the tree and stable cursor pagination of children.
  (Optionally later: `id` as a second key in `buildOrderBy`.)
- Files with `\u0000` (binaries named `.md`) rejected earlier as `binary` — Postgres `text` will not accept them.
- Known Prisma/PG errors in the transaction → 400/422 with a readable description, not a bare 500 (cf. D5).
- Full rollback on error. No `NoteVersion` (import = the initial version).
- **No database migration needed.**

## 6. Indexing

**FTS** — automatic. Nothing to do.

**RAG** — automatic, but slow: by default 20 notes every 30 s → 1000 notes ≈ 25 min.
A change in `RagIndexerService` (without coupling notes ↔ ai):

- **"Drain" mode**: if a round **fetched** a full batch (`notes.length === indexBatchSize`, not the number
  of successes — a single note error must not stop the drain), the next round starts immediately
  (~250 ms); otherwise after `indexIntervalMs`.
- Provider unavailable (the path returning 0) → the normal interval.
- `indexPending` returns the number of fetched notes (or the next delay) to `schedule`; today `schedule`
  always uses `indexIntervalMs` in `.finally`.
- No parallel rounds (`running`), the loop stops after `onModuleDestroy`.
- `updatedAt` ties are harmless: indexed rows drop out of the filter, `replaceChunks` compares `updatedAt` to the millisecond.
- The debounce (`RAG_INDEX_DEBOUNCE_MS`) stays.

A deliberate trade-off: `findNotesToIndex` sorts by `updatedAt` across **all** users — one user's large import
delays other users' fresh edits for the duration of the import. Fine for a self-hosted install;
with many users, per-user round-robin later.

Rejected alternative: a `notes.imported` event → the indexer (a new `@nestjs/event-emitter` dependency
or a notes → ai dependency; today it is the other way round).

**Progress**: `GET /api/ai/settings` → `rag.stats { totalNotes, indexedNotes, chunks }` (null when RAG is disabled).

**Chat**: unchanged — `semantic_search` and auto-context search the given `userId`'s `NoteChunk`s.

## 7. Frontend (`../notes-app-fe`, read its `CLAUDE.md` before making changes)

- Feature `features/import-notes`: an "Import" button in the sidebar → a modal.
- Step 1: folder (`webkitdirectory`) / `.md` files / "one file, split by H1".
  The path from `webkitRelativePath` without the first segment (that one → the default `name`); when files are
  picked without a folder `webkitRelativePath === ""` → `file.name`. A preliminary filter for non-markdown and hidden folders.
- `.zip`: unpacked in the browser with the `fflate` library (a new FE dependency — about 8 kB, no dependencies,
  streaming; reason: the server does not receive a binary zip and does not need to defend against zip bombs). Rules:
  - read only `.md`/`.markdown` entries, count the rest as skipped (attachments),
  - a limit on the total unpacked bytes counted on the fly (the same as `MAX_IMPORT_TOTAL_BYTES`) — abort before the tab eats the memory,
  - Notion splits large exports into a zip inside a zip (`Export-…-Part-1.zip`) — unpack nested zips one level deep,
  - file names: the UTF-8 flag in the zip; without it (zips from Windows, CP437 encoding) Polish characters may arrive garbled — a warning in the report,
  - a common parent directory in the zip (`MyVault/…`) is stripped and used as the default `name`.
- Step 2: `dryRun` → a summary: number of notes, grouped warnings (especially `lossy-content`), skipped files.
- Step 3: import → invalidate the tree/list, navigate to `rootNoteId`, a bar "Indexing for AI: 340 / 1000":
  polling every ≥ 5 s (the `global` 40/min and `auth` 25/min throttlers count per IP and handler), stop when `stats === null`,
  RAG is disabled, or there is no progress for several polls.
- Security follow-up (independent of import): `openLink` (`EditorUi.ts`) calls `window.open(href)` on the raw
  attribute — add a scheme check (http(s)/mailto/relative).

## 8. Security

- **Authorization**: `userId` only from the JWT; `targetParentId` via `assertOwnedNote` → 404. E2E `AC-AUTHZ`:
  B imports under A's note → 404; B's notes invisible to A.
- **Paths**: the server does not touch the FS; validating `..`/absolute paths for a consistent report and defence in depth.
- **Size/DoS**: a separate parser only for the import route, CSRF before the parser, file and byte limits,
  throttling, a transaction timeout.
- **Prompt injection**: imported content is untrusted like any note; the agent stays read-only.
- **XSS**: raw HTML does not reach the DOM (Tiptap parses it with an inert DOMParser, the schema rejects unknown tags,
  the link's `renderHTML` blocks disallowed `href`s). The real risk is `javascript:`/`data:` in links opened by
  `openLink` — they are neutralized on import (`unsafe-link`) and an FE fix is reported.
- **High-risk paths**: the `configureApp` change touches the HTTP pipeline — the diff must be read in full + `/security-review`.

## 9. Decisions (all decided 2026-10-25)

1. MVP input format — **folder + many files + `.zip` + `split-h1`**.
2. Frontmatter — **a ```yaml block in the content** (lossless; real tags/dates/aliases are phase 2).
3. Import root — **always** ("Import: Obsidian 2026-10-15"), optionally under an owned `targetParentId`.
4. Canonicalizing content through Tiptap on import — **no** (lossless in the database + a `lossy-content` warning).
5. Re-import — **always new notes under a new root**. Updating
   previously imported notes is a separate problem (matching, conflicts with edits in the app) — phase 2.
6. Empty files — **create only those some link points to; skip the rest** (`skipped: empty`).
   Empty = whitespace only (also when nothing remains after cutting the frontmatter).
7. Other formats (item 12) — **`.txt` in the MVP** (imported as markdown); PDF/HTML/DOCX text extraction in phase 2;
   storing originals (attachments) as its own concept document.

## 10. Risks and open questions

- **No `DELETE /notes`** — an import cannot be undone from the UI today. A separate task: `DELETE /notes/:id`
  deleting the subtree (`NoteChunk` has `onDelete: Cascade`; `NoteVersion` and `parentId` do not).
- **Content loss on edit** (tables, images, HTML) — item 5.3; needs a decision about the FE follow-up.
- A ~20 MB payload in one request — acceptable for a one-off operation; larger vaults in phase 2.
- Logseq/Notion in the MVP as plain markdown — they may look "raw".
- A chunk's `headingPath` starts with the note title, not its ancestors — a "Docker" note in a "Projects" folder
  has no "Projects" context in its embedding. Phase 2: the ancestor path in `embeddingText`.

## 11. Unit test plan (next step)

Pure functions first (TDD), then the service with a mocked Prisma, then the indexer.

**`importPath.spec.ts`**
- `Projects\\Docker.md` → `['Projects', 'Docker.md']`; NFD → NFC
- rejects `../x.md`, `/etc/x.md`, `C:/x.md`, `a//b.md`, `""` → `invalid-path`
- `.obsidian/…`, `.trash/…`, `.DS_Store` → `hidden`
- `isMarkdownPath`: `.md`, `.MD`, `.markdown` → true; `.png`, `.txt`, `md` → false

**`frontmatter.spec.ts`**
- no frontmatter → unchanged
- `---\ntitle: X\n---\ncontent` → extracted; `readTitle` → `X`; `"X: y"` → `X: y`
- unclosed `---` → content; `---` not on the first line → content
- the resulting content has the frontmatter as a ```yaml block (with `title:`)

**`importTitle.spec.ts`**
- `Docker.md` → `Docker`; `Plan 1a2b…(32 hex).md` → `Plan`
- `A.md` → `A (import)` + `title-fallback`; `   .md` → fallback
- title > 200 characters → truncated + `title-truncated`

**`splitCombined.spec.ts`**
- three H1s → three files; text before the first H1 → a note named after the file
- `#` in a code block and `## H2` do not split
- H1 `CI/CD` → one note, no folder; duplicate H1s → unique paths

**`markdownScan.spec.ts`**
- ``` inside a ~~~ block (and vice versa) does not close the block; a longer fence
- an indented code block and a `` ` `` span are skipped

**`buildImportTree.spec.ts`**
- flat files → children of the root
- `A/B/c.md` → folder notes A, B, a `parentId` chain
- `A/index.md` and `A.md` next to `A/` → merged into the folder note, no duplicate
- parents before children; sibling order case-insensitive `localeCompare` → increasing `order`
- duplicate path (different case) → `duplicate-path`

**`resolveLinks.spec.ts`**
- every row of the table in item 5.3 (including `\|` in a table, `#^block`, `![[Note]]`, `%20`, `<…>`, `.md#x`)
- unsafe schemes → text only + `unsafe-link`
- links in code untouched
- relative path `../`, from the root, suffix, case-insensitive basename, NFC vs NFD
- ambiguity: shortest path; length tie → lexicographic
- `]` in a wiki-link title escaped; the text `[a\]b](x.md)` not escaped again
- a link to itself and to a folder note
- standalone line / list item / inline — the result and the expected node type (golden fixtures, now FE-only — ADR 0003)

**`detectLossy.spec.ts`**
- GFM table, `![]()`, `<div>`, `[^1]` → `lossy-content`; the same in a code block → nothing

**`planImport.spec.ts`**
- deterministic result with an injected `newId`; **shuffled input → identical plan**
- non-markdown, hidden, `\u0000` → `skipped` with the right reason; an empty file some link points to → created, without a link → `empty`
- `split-h1` with one file; `split-h1` with many files → error
- no `parentId` points outside the plan (except the root)

**`notesImport.service.spec.ts`** (Prisma mocked)
- `dryRun` → zero writes, `rootNoteId: null`
- exceeding `MAX_IMPORT_TOTAL_BYTES` (counted in UTF-8 bytes) → `BadRequestException`
- someone else's/a non-existent `targetParentId` → `NotFoundException`, zero writes
- `createMany`: `userId` from the argument in every row, batches ≤ 500, parents before children,
  `createdAt` increasing according to `order`, the root's `parentId` = `targetParentId`
- a known Prisma error in the transaction → 4xx; an unknown one → propagated

**`ragIndexer.service.spec.ts`** (extension; `npm run test:ai` — 100% coverage)
- full batch → the next round immediately; partial → `indexIntervalMs`
- full batch with one note error → the drain continues
- provider unavailable → the normal interval
- `onModuleDestroy` during a drain → no further round

**E2E** (`test/notes.import.e2e-spec.ts`, after the unit tests)
- importing a folder → a tree in the right order; `GET /notes/search?q=` finds content from the import
- a rewritten link points to a note of the same user
- `AC-AUTHZ`: B under A's note → 404; B's notes invisible to A
- without CSRF → 403; > 25mb → 413; other routes still 413 > 2mb; 2001 files → 400

## 12. Other file formats (proposal, not decided)

The MVP imports markdown only; every other file is skipped with `attachment-skipped`. Two separate problems:

**A. Make the content of other formats searchable and visible to RAG** — extract the text in the browser
(like the zip) and send it as a regular `{ path, content }` note, e.g. "Report 2024.pdf" with the text as markdown
and a line "source: report.pdf (the original is not stored)". FTS and RAG then work unchanged; the server
never parses binaries.

| Format | How | Notes |
|---|---|---|
| `.txt` | as markdown | almost free — candidate for the MVP |
| `.html` (Notion, Evernote) | HTML → markdown (e.g. `turndown`) | new FE dependency |
| `.pdf` with a text layer | text extraction (e.g. `pdfjs-dist`) | new FE dependency; tables and columns come out poorly |
| `.docx` | `mammoth` → markdown | new FE dependency |
| scanned PDFs, images | OCR or a vision model | slow and costly; with Claude it spends the user's quota — on demand only |

**B. Keep the original file in the app (preview/download)** — a separate feature: file storage (volume, MinIO/S3
or `bytea`), an `Attachment` model + migration, upload/download endpoints scoped by `userId` (AC-AUTHZ),
safe serving (type checks, limits, `Content-Disposition: attachment`, `nosniff`), image/file nodes in the editor,
and rewriting `![[diagram.png]]` to `/api/attachments/<id>`.

Recommendation: `.txt` in the MVP; A for PDF/HTML/DOCX in phase 2; B as its own concept document.

## 13. Status (2026-10-25)

- All decisions in item 9 are made (the recommendations were accepted).
- **BE implemented** (branch `Radek-Lejman/feature-import-module`): the pure functions in `src/modules/notes/import/`,
  `NotesImportService`, `POST /api/notes/import`, the route's own parser in `configureApp`, the RAG drain mode,
  unit tests and `test/notes.import.e2e-spec.ts`.
- Differences from the text above, decided during the implementation:
  - `.txt` is imported as markdown: `isImportablePath` (`.md`, `.markdown`, `.txt`) instead of `isMarkdownPath`.
  - `markdownScan.maskCode` returns the markdown with code replaced by a private-use character (same length),
    so the other functions search the masked text and slice the original.
  - `split-h1` keeps the `# H1` line in the note content (lossless); the title is its plain text.
  - Besides inline links and wiki links, reference definitions (`[id]: x.md`) and autolinks (`<javascript:…>`)
    are rewritten or neutralized; scheme checks decode entities and drop whitespace like a browser.
  - A note longer than `MAX_CONTENT_LENGTH` after link rewriting fails the whole import (400 with the file name)
    instead of being skipped, which would leave links to a missing note.
  - A real import with nothing importable is a 400; a dry run still reports it.
  - `express` is a direct dependency (the same 5.2.1 Nest uses) for the route's JSON parser.
- Next: the FE feature (item 7), then `DELETE /notes/:id` for undoing an import (item 10).
