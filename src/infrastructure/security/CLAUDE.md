# Security infrastructure (src/infrastructure/security)

High risk: every change here needs the full diff read by the user and `/security-review`.

- CSRF: `csurf` with the secret in an httpOnly `XSRF-TOKEN` cookie; clients get the token from `GET /api/csrf-token` and send it in `X-CSRF-Token`. GET requests are not checked — a test of a mutating route must prove CSRF passes (see `test/support`).
- Throttling: two named throttlers (`global`, `auth`) apply to every route, so the effective limit is the lower one per route and app instance — mind it in e2e. `@Throttle({ … })` keys must match those names (defect D3).
- Brute force: `services/bruteForceService.ts` + guard/filter. In-memory, per app instance; an active lock must never be lifted by the window reset (D11, fixed). Counts per client only (`utils/clientKey.ts`: IPv4, or IPv6 by /64 — the throttler uses the same key). No account-wide key (it lets strangers lock owners out, S4) and no reset on a successful login (S5).
- Client IP: `TRUST_PROXY` (hops, default 0) sets Express `trust proxy` in `configureApp`. Behind a proxy (Railway) it must be 1, or every user shares the proxy IP; never > 0 without a proxy, or X-Forwarded-For is spoofable.
- `crypto/secretBox.ts`: AES-256-GCM, payload `v1:iv:tag:ciphertext`, `context` (user id) bound as AAD. Changing the format = new version prefix (`v2`) while `v1` still decrypts; never reuse IVs; never log plaintext or keys.
- Config (`config/`): helmet, CORS, CSRF, throttle limits. Weakening any of them (e.g. CORS origin `*`, `sameSite: none`) requires the user's explicit consent.
