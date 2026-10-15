/**
 * Deterministic env for unit tests (jest `setupFiles`). Runs before any test module is loaded,
 * so modules that read env at import time (JWT configs) never depend on a local .env —
 * which @prisma/client would otherwise load as a side effect of being imported.
 */
process.env.JWT_ACCESS_SECRET = 'unit-test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'unit-test-refresh-secret-0123456789abcdef';
process.env.AI_CREDENTIALS_SECRET = 'unit-test-ai-credentials-secret-0123456789';
