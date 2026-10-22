# Architecture Decision Records

Format (Nygard): Status · Context · Decision · Alternatives · Consequences. One file per decision, numbered `NNNN-slug.md`. Accepted ADRs are not edited — a changed decision is a new ADR that supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-markdown-as-note-content.md) | Note content stored as markdown | accepted, partly superseded by 0003 |
| [0002](./0002-per-user-claude-credentials.md) | AI on the user's own account, credentials encrypted with `SecretBox` | accepted |
| [0003](./0003-markdown-serializer-fe-only.md) | The markdown serializer lives only in the FE | accepted |
