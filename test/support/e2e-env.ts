import { readFileSync } from 'fs';
import { join } from 'path';

/** Local default: the docker-compose database (port 5433). CI sets DATABASE_URL itself. */
const DEFAULT_DATABASE_URL = 'postgresql://admin:secret@localhost:5433/notes_e2e';

/**
 * Deterministic env for e2e tests, shared by jest `globalSetup` (migrations) and `setupFiles`
 * (the app). ConfigModule and @prisma/client copy every variable from the local .env that is
 * not already set, so each key from .env.example is set here (empty = the code default).
 * That way a local run sees the same configuration as CI.
 */
export function applyE2eEnv(): void {
  const example = readFileSync(join(__dirname, '../../.env.example'), 'utf8');
  for (const [, key] of example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) {
    if (key !== 'DATABASE_URL') process.env[key] = '';
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ||= DEFAULT_DATABASE_URL;
  // No background indexer and no calls to Ollama.
  process.env.RAG_ENABLED = 'false';
}

/** Refuses to run against anything that does not look like a throwaway test database. */
export function assertTestDatabase(url = process.env.DATABASE_URL): void {
  const name = url ? new URL(url).pathname.slice(1) : '';
  if (!/_(e2e|test)$/.test(name)) {
    throw new Error(
      `[e2e] DATABASE_URL must point to a database named *_e2e or *_test (got "${name}"); ` +
        'the e2e suite truncates every table.',
    );
  }
}
