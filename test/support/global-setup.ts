import { execFileSync } from 'child_process';
import { join } from 'path';
import { applyE2eEnv, assertTestDatabase } from './e2e-env';

/** Runs once before the e2e suite: applies migrations (Prisma creates the database if missing). */
export default function globalSetup(): void {
  applyE2eEnv();
  assertTestDatabase();

  const root = join(__dirname, '../..');
  execFileSync(join(root, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
}
