# Security infrastructure (src/infrastructure/security)

High risk: every change here needs the full diff read by the user and `/security-review`.

- CSRF: `csurf` with the secret in an httpOnly `XSRF-TOKEN` cookie; clients get the token from `GET /api/csrf-token` and send it in `X-CSRF-Token`. GET requests are not checked — a test of a mutating route must prove CSRF passes (see `test/support`).
- Throttling: two named throttlers (`global`, `auth`) apply to every route, so the effective limit is the lower one per route and app instance — mind it in e2e. `@Throttle({ … })` keys must match those names (defect D3).
- Brute force: `services/bruteForceService.ts` + guard/filter; known defect D11.
- `crypto/secretBox.ts`: AES-256-GCM, payload `v1:iv:tag:ciphertext`, `context` (user id) bound as AAD. Changing the format = new version prefix (`v2`) while `v1` still decrypts; never reuse IVs; never log plaintext or keys.
- Config (`config/`): helmet, CORS, CSRF, throttle limits. Weakening any of them (e.g. CORS origin `*`, `sameSite: none`) requires the user's explicit consent.
