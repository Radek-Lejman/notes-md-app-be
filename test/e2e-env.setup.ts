import { applyE2eEnv, assertTestDatabase } from './support/e2e-env';

// jest `setupFiles` for e2e: runs before any test module (and the app) is loaded.
// Must come before unit-env.setup.ts, which then sets the JWT secrets blanked here.
applyE2eEnv();
assertTestDatabase();
