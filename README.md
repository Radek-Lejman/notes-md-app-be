# Security Overview

This project ships with a layered “Security” setup designed as a dedicated module plus a cohesive set of configurations. Below is a README-ready overview of what’s enabled, why, and how it works.

---

## What’s Included

- **HTTP hardening:** CORS, CSRF (double-submit cookie), Helmet (CSP, HSTS, Frameguard, noSniff, CORP/COEP).
- **Rate limiting:** global and `/auth`-scoped throttling, with a custom exception filter that sets `Retry-After`.
- **Brute-force protection:** guard + in-memory counter keyed by IP and email, time-windowed attempts and temporary locks, consistent `429` JSON.
- **Authentication:**
  - Access token (JWT) — short-lived, stored in an `httpOnly` cookie.
  - Refresh token — rotated and tracked in DB (Prisma) with `jti`, `expiresAt`, and `revoked`, with reuse detection.
- **Configuration:** everything registered via `@nestjs/config`, times expressed in human-friendly strings (via `ms`), prod/dev behavior toggled by `isProd`.

---

## Middleware & Headers

### CORS

- origin: `'http://localhost:5173'`
- credentials: `true`
- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
- Allowed headers: `Content-Type`, `Authorization`, `X-XSRF-TOKEN`

This allows the SPA (Vite/React) to send credentialed requests (cookies) safely.

### CSRF (`csurf`)

- Double-submit cookie pattern:
  - Backend sets an `httpOnly` cookie `XSRF-TOKEN`.
  - Client echoes that value in the `X-XSRF-TOKEN` header for state-changing requests.
- Cookie flags: `sameSite: 'strict'` and `secure: true` in production.

### Helmet

- CSP with secure defaults (restrictive `default-src`, `script-src`, and explicit `connect-src` to local dev host).
- `frameguard: 'deny'`, `noSniff`, `dnsPrefetchControl: off`, `CORP = same-origin`.
- COEP tightened in production: `crossOriginEmbedderPolicy: 'require-corp'` (or disabled in dev).
- HSTS with a 7-day `maxAge`, `includeSubDomains`, and `preload`.

`maxAge` is derived using `ms('7d') → seconds`, to keep config human-readable.

---

## Rate Limiting

### Throttling Profiles

- **Global:** 1m / 40 requests.
- **Auth (/auth):** 1m / 25 requests.

### ThrottlerExceptionFilter

- Automatically chooses the correct TTL (global vs `/auth`) by inspecting the request URL.
- Sets the `Retry-After` header (in seconds).
- Returns a consistent JSON:

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please try again in N seconds."
}
```

# Brute-force Protection (login)

## BruteForceService (in-memory)

- Keys: `ip:<addr>` and `acct:<email>`.
- Defaults:
  - Window: 30s
  - Max attempts: 20
  - Lock: 2m
- Resets counters after a successful login; increments after a failed one.
- In production, consider a persistent store (e.g., Redis).

## BruteForceGuard (applied to /auth/login)

- Builds keys (ip, email), stores them on `req.__bfKeys`.
- If locked: logs a warning, sets `Retry-After`, and throws `TooManyRequestsException(retryAfter)`.

## BruteForceExceptionFilter

- Catches `TooManyRequestsException`, sets `Retry-After`, returns a uniform `429` JSON with a `retryAfter` field.

---

# Authentication & Sessions

## Access Token (JWT)

- Issued by `AccessTokenService` using the JWT config (`secret`, `expiresIn`, e.g., `15m`).
- Stored in an `httpOnly` cookie: `access_token` (with `sameSite` and `secure` toggled by `isProd`).

## JwtAuthGuard

- Reads token from cookie, verifies it, and attaches the payload to `req.user`.
- On failure: throws `401 Unauthorized`.

## Refresh Token (rotated with reuse detection)

- Issued by `RefreshTokenService`:
  - Generates a `jti`.
  - Computes `expiresAt` from `refresh-jwt.expiresIn` (e.g., `'7d'` → `Date` via `ms`-based helper).
  - Persists a `RefreshToken` record (Prisma).
  - Signs a refresh JWT with payload: `sub`, `email`, `jti`, `tokenVersion`.

### Rotation flow (`POST /auth/refresh`)

1. Verify refresh JWT (`secret`, `exp`).
2. Lookup by `jti` in DB:
   - No record or `revoked = true` ⇒ reuse detected → 401.
   - `expiresAt` in the past ⇒ expired → 401.
3. Revoke old record (`revoked = true`).
4. Issue: new DB record + new refresh JWT + new access JWT.

## Revoke All Sessions

- `updateMany` (by userId) setting `revoked = true` to force-logout from all devices.

## Cookies (`setAuthCookies`)

- Helper sets `access_token` and `refresh_token` cookies with `httpOnly`, `sameSite`, `secure` (prod), and correct `maxAge`.
- Durations are derived from typed config values (`"15m"`, `"7d"`) → seconds.

---

# Configuration & Time Handling

- All configs are registered via `@nestjs/config` (`registerAs`) and consumed with proper typing:
  - `jwt (access): { secret, expiresIn: "15m" }`
  - `refresh-jwt: { secret, expiresIn: "7d" }`
  - `bruteForce: { windowMs: ms("30s"), maxAttempts: 20, lockMs: ms("2m") }`
- `ms` library standardizes durations across the app (`"30s"` | `"2m"` | `"7d"` → milliseconds).
- `isProd` toggles stricter security (cookies, headers, COEP/COEP).

---

# Module Structure (high level)

- `infrastructure/security`
  - Config: `cors.config.ts`, `csrf.config.ts`, `helmet.config.ts`, `throttle.config.ts`, `bruteForce.config.ts`
  - Guards & Filters: `BruteForceGuard`, `BruteForceExceptionFilter`, `ThrottlerExceptionFilter`
  - Services: `BruteForceService`
  - Module: `SecurityModule` (registers configs and global filters)
- `modules/auth`
  - Config: `jwt.config.ts`, `refreshJwt.config.ts`
  - Services: `AccessTokenService`, `RefreshTokenService`
  - Guards: `JwtAuthGuard`
  - Utils: `cookie.util.ts`, `expiresIn.ts` (computes `expiresAt`)
  - DB: Prisma model `RefreshToken` (with `jti`, `revoked`, `expiresAt`)

---

# Quick Test Scenarios

1. **Brute-force lock**
   - Send 20 invalid `/auth/login` attempts within 30 s.
   - Expect `429` with `Retry-After` header and JSON body containing `retryAfter`.
2. **Global rate limit**
   - Send 40 requests to any non-auth route within 60 s.
   - Expect `429` with consistent JSON and `Retry-After`.
3. **Refresh rotation**
   - Login → get refresh A1.
   - Call `/auth/refresh` → get A2 (new refresh), and DB shows A1 `revoked = true`.
4. **Reuse detection**
   - After rotation, call `/auth/refresh` again using A1.
   - Expect `401` with message like `"Refresh token reuse detected"`.
5. **Revoke all**
   - Call the “revoke all” endpoint (force logout).
   - Expect all user’s refresh token records set to `revoked = true`.

---

# Why This Matters

- Defense in depth: headers + CORS/CSRF + throttling + brute-force + secure cookies + refresh rotation.
- Session safety: `httpOnly` cookies, short-lived access JWT, rotated refresh with reuse detection.
- Consistent errors: custom exception filters set `Retry-After` and return uniform JSON responses.
- Clean configuration: secrets and durations centralized and typed; easy to tune.

---

# Tuning Knobs

- Durations & limits (single source of truth):
  - `jwt.expiresIn`, `refresh-jwt.expiresIn`
  - `bruteForce.windowMs`, `bruteForce.maxAttempts`, `bruteForce.lockMs`
  - `throttle.*.ttl`, `throttle.*.limit`
  - `hsts.maxAge` (e.g., `ms('7d')`)
- Cookies: `secure`, `sameSite` based on `isProd`.
- CSP/COEP: tighten allow-lists and cross-origin policies for production as needed.

---