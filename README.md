# notes-app-be

NestJS backend for a Notion-style notes app with unlimited-depth nested pages, full-text search across JSONB content, and stateful JWT authentication with per-token rotation and global revoke.

> **Companion repo:** [notes-app-fe](../notes-app-fe) — React frontend with TipTap rich-text editor and inline note linking.

---

## Tech Stack

| Category  | Technology                                                     |
| --------- | -------------------------------------------------------------- |
| Framework | NestJS 11 + TypeScript 5.7                                     |
| Database  | PostgreSQL + Prisma ORM 6                                      |
| Auth      | JWT (access + refresh) + httpOnly cookies                      |
| Search    | PostgreSQL FTS — GIN indexes on JSONB                          |
| Security  | Helmet, HSTS, CSRF double-submit, Throttler, Brute-force guard |
| Runtime   | Node 20                                                        |

---

## Getting Started

### Option A — Local (Node + PostgreSQL)

**Prerequisites:** Node 20+, PostgreSQL instance.

```bash
npm install

# Create .env (no .env.example in repo — create manually)
cat > .env <<'EOF'
DATABASE_URL=postgresql://user:password@localhost:5432/notes
JWT_ACCESS_SECRET=your-access-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_ACCESS_EXPIRE_IN=15
JWT_REFRESH_EXPIRE_IN=14
EOF

# Run migrations and generate Prisma client
npm run db:migrate

# Start dev server with watch
npm run start:dev
# → http://localhost:3000/api
```

### Option B — Docker Compose

```bash
# Requires .env in repo root (see above)
docker compose up
# Backend available at http://localhost:3000/api
```

Three services start in order: `db` (PostgreSQL) → `migrator` (runs `prisma migrate deploy`) → `backend`. No manual migration step needed.

---

## API Reference

All routes are prefixed `/api`. JWT is required globally — endpoints marked **Public** opt out via `@PublicEndpoint()`.

### Auth

| Method | Endpoint          | Auth                     | Description                                   |
| ------ | ----------------- | ------------------------ | --------------------------------------------- |
| `POST` | `/auth/register`  | Public                   | Register; returns httpOnly cookies            |
| `POST` | `/auth/login`     | Public + BruteForceGuard | Login; sets access + refresh cookies          |
| `GET`  | `/auth/me`        | JWT                      | Returns JWT payload for current session       |
| `POST` | `/auth/refresh`   | Public (rate-limited)    | Rotate refresh token; issue new access token  |
| `POST` | `/auth/logout`    | JWT                      | Clear auth cookies                            |
| `POST` | `/auth/revokeAll` | JWT                      | Invalidate all sessions (bump `tokenVersion`) |

### CSRF

| Method | Endpoint      | Auth   | Description                              |
| ------ | ------------- | ------ | ---------------------------------------- |
| `GET`  | `/csrf-token` | Public | Issue CSRF token (double-submit pattern) |

### Notes

| Method  | Endpoint        | Auth | Description                                   |
| ------- | --------------- | ---- | --------------------------------------------- |
| `GET`   | `/notes`        | JWT  | List all notes for current user               |
| `POST`  | `/notes`        | JWT  | Create note (optional `parentId` for nesting) |
| `GET`   | `/notes/search` | JWT  | Full-text search with cursor pagination       |
| `GET`   | `/notes/:id`    | JWT  | Fetch note + children tree + optional parent  |
| `PATCH` | `/notes/:id`    | JWT  | Update title / content                        |

**`GET /notes/:id` query params:** `fields`, `children.fields`, `children.sort`, `children.limit`, `depth`, `expand=parent`

**`GET /notes/search` query params:** `q` (required), `fields`, `order`, `limit`, `cursor`

---

## Architecture

```
src/
├── main.ts                    # Bootstrap: CORS, CSRF, Helmet, ValidationPipe
├── app.module.ts              # Root module — global guards registered here
│
├── modules/
│   ├── auth/                  # Auth + CSRF controllers, JWT services, guards
│   └── notes/                 # Notes controller + 3-layer service design
│         ├── service/         # UserNotesService, NotesService, NotesTreeService, NotesSearchService
│         └── utils/           # NotesPgRepository (raw SQL FTS), NoteMapper
│
├── infrastructure/
│   ├── database/prisma/       # PrismaService, PrismaModule, FTS utilities
│   └── security/              # Brute-force guard/service, throttle/helmet configs
│
└── core/                      # Framework-agnostic utilities
    ├── tree/                  # Generic TreeService<T> (DFS + O(1) Map index)
    ├── selector/              # FieldSelector — dynamic Prisma field projection
    ├── sort/                  # buildOrderBy — "-createdAt" → Prisma orderBy
    └── config/                # envString / envNumber / envSecret helpers
```

### Path aliases

```
@security   → src/infrastructure/security
@core       → src/core
@common     → src/common
@database   → src/infrastructure/database
```

### Notes — 3-layer service design

`NotesController` delegates exclusively to `UserNotesService` (orchestrator), which composes three focused services:

```
NotesController
  └─ UserNotesService          ← orchestrator; no logic, only delegation
       ├─ NotesService         ← Prisma CRUD; delegates FTS to NotesPgRepository
       │     └─ NotesPgRepository  ← raw SQL with GIN-indexed plainto_tsquery FTS
       ├─ NotesTreeService     ← tree loading (depth, children limit, sort)
       │     └─ TreeService<T> ← generic DFS + Map<id, node> from @core/tree
       └─ NotesSearchService   ← FTS orchestration + cursor pagination options
```

Each service has exactly one responsibility; `UserNotesService` is the only entry point for the controller, so adding a new operation never touches existing service boundaries.

---

## Database Schema

```prisma
model User {
  id           String         @id @default(uuid())
  email        String         @unique
  password     String                              // bcrypt, 12 rounds
  tokenVersion Int            @default(0)          // bumped on revokeAll
  notes        Note[]
  RefreshToken RefreshToken[]
}

model Note {
  id       String        @id @default(uuid())
  title    String
  content  Json                                   // JSONB; GIN-indexed for FTS
  userId   String
  parentId String?                                // null = root note
  parent   Note?         @relation("NoteToChildren", ...)
  children Note[]        @relation("NoteToChildren")
  versions NoteVersion[]                          // version history (endpoint in progress)
}

model RefreshToken {
  id        String   @id @default(uuid())
  jti       String   @unique                      // per-token identity
  userId    String
  revoked   Boolean  @default(false)              // set true on rotation
  expiresAt DateTime
}
```

---

## Authentication

### Token lifecycle

```
Register / Login
  ├─ issue access token (JWT, 15 min, httpOnly cookie)
  └─ issue refresh token (JWT, 14 days, httpOnly cookie)
       └─ persisted as RefreshToken record in DB (jti, expiresAt)

POST /auth/refresh
  ├─ verify refresh JWT (signature + expiry)
  ├─ load User by payload.sub
  ├─ check payload.tokenVersion === user.tokenVersion
  ├─ issue new access token
  └─ rotate refresh token (RefreshTokenService.rotate):
       ├─ load RefreshToken by jti → check revoked = false
       ├─ check expiresAt not expired
       ├─ mark old RefreshToken revoked = true
       └─ create new RefreshToken record + new refresh JWT

POST /auth/revokeAll
  └─ UPDATE User SET tokenVersion = tokenVersion + 1
       → all existing refresh tokens fail the tokenVersion check
       → no DB scan over RefreshToken table needed (O(1))
```

**Two invalidation mechanisms running in parallel:**

- `RefreshToken.revoked` — per-token rotation (reuse detection on stolen tokens)
- `User.tokenVersion` — global revoke-all (force-logout from all devices in one write)

### Global guard strategy

Both guards are registered as `APP_GUARD` providers in `AppModule` — they apply to every route automatically:

```typescript
{ provide: APP_GUARD, useClass: ThrottlerGuard },
{ provide: APP_GUARD, useClass: JwtAuthGuard },
```

`JwtAuthGuard` checks for the `isPublic` metadata key set by `@PublicEndpoint()`:

```typescript
// common/decorators/public.decorator.ts
export const PublicEndpoint = () => SetMetadata('isPublic', true);

// JwtAuthGuard reads it via Reflector
const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
  context.getHandler(),
  context.getClass(),
]);
if (isPublic) return true;
```

Routes that need to opt out (register, login, refresh, csrf-token) use `@PublicEndpoint()`. Everything else is protected by default with no extra annotation required.

---

## Full-Text Search

### Two-stage pattern

FTS uses a deliberate two-stage approach to combine GIN index performance with Prisma's type-safe pagination:

```
Stage 1 — raw SQL via NotesPgRepository:
  SELECT id FROM "Note"
  WHERE "userId" = $userId
  AND (
    to_tsvector('simple', coalesce("title", ''))  @@ plainto_tsquery('simple', $q)
    OR
    to_tsvector('simple', "content")              @@ plainto_tsquery('simple', $q)
  )
  → returns: string[]  (matching IDs only)

Stage 2 — Prisma findMany:
  note.findMany({
    where: { userId, id: { in: matchingIds } },
    select: { ...fieldSelector },
    orderBy,
    cursor: { id: cursorId },
    take,
  })
  → returns: typed Note[] with field projection + cursor pagination
```

**Why two stages:** GIN indexes make stage 1 fast on JSONB, but Prisma cannot express `to_tsvector @@ plainto_tsquery` in its query builder. Splitting keeps GIN efficiency for matching and Prisma's type safety for everything downstream (projection, sorting, pagination).

**Why `plainto_tsquery`:** accepts raw user input without requiring the user to know tsquery syntax. `'hello world'` → searches for documents containing both words.

**Why cursor pagination instead of OFFSET:** results stay stable when notes are added or updated between pages. `OFFSET N` can skip or repeat rows if the result set changes; a cursor keyed on `id` cannot.

### GIN indexes (created in migration)

```sql
CREATE INDEX note_title_fts_idx
  ON "Note" USING GIN (to_tsvector('simple', coalesce("title", '')));

CREATE INDEX note_content_fts_idx
  ON "Note" USING GIN (to_tsvector('simple', "content"));
```

`'simple'` dictionary: no stemming, no stop words — searches match the literal token. Appropriate for user-generated note content where stemming would produce surprising results.

---

## Security Hardening

| Layer         | Config                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| CSRF          | Double-submit cookie — backend sets `XSRF-TOKEN` cookie; client echoes value in `X-CSRF-Token` header |
| Helmet        | CSP, `frameguard: deny`, `noSniff`, CORP `same-origin`, COEP `require-corp` (prod)                    |
| HSTS          | `maxAge: 7d`, `includeSubDomains`, `preload`                                                          |
| Rate limiting | Global: 40 req/min · Auth routes: 25 req/min                                                          |
| Brute-force   | Per IP + per email · window: 30s · max: 20 attempts · lock: 2 min                                     |
| Passwords     | bcrypt, 12 rounds                                                                                     |

---

## Scripts

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `npm run start:dev`   | Dev server with watch mode               |
| `npm run build`       | Compile to `dist/`                       |
| `npm run start:prod`  | Run compiled build                       |
| `npm run test`        | Unit tests (Jest)                        |
| `npm run test:e2e`    | End-to-end tests                         |
| `npm run db:migrate`  | Run Prisma migrations + generate client  |
| `npm run db:generate` | Generate Prisma client only              |
| `npm run db:reset`    | Reset database and re-run all migrations |
| `npm run lint`        | ESLint with auto-fix                     |
