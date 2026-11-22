# Authentication credential verification in Express

WedPlan uses one authentication system: Better Auth 1.7.x with the official
MongoDB adapter. Express verifies the browser's credentials by asking that same
Better Auth instance to resolve the request cookies; it does not implement a
second, unrelated authentication mechanism.

## Credential flow

1. The browser calls `/api/auth/*` on the Express server with
   `credentials: "include"` (see `wedplan-client/src/lib/auth-client.ts`).
2. Better Auth stores an opaque session token in an HttpOnly cookie and a
   matching session document in the `session` MongoDB collection. No JWT is
   issued, stored in localStorage, or trusted by application code.
3. Protected routers call `requireSession`, `requireCustomer`, `requireVendor`,
   or `requireAdmin` (`src/middleware/require-*.ts`). Each middleware forwards
   the incoming `Cookie` header to `auth.api.getSession()` and therefore relies
   on Better Auth's token lookup, signature/format validation, database session
   lookup, and expiry handling.
4. `authorizeSession()` additionally rejects missing/invalid identities, expired
   sessions, blocked accounts, and roles that are not allowed for the route.
   Role checks always run on the server; client-side guards are UX only.
5. Blocked users are also prevented from creating any new session through the
   `session.create.before` database hook in `src/lib/auth.ts`, which covers
   email/password and Google OAuth sign-in.

## JWT status

There is deliberately **no JWT verification layer**: the project has no JWT
dependency and Better Auth is configured with database-backed sessions. Adding
a parallel JWT system would create a second source of truth and is unnecessary.
If a future deployment requires JWTs, use a Better Auth-supported JWT plugin and
verify signature, issuer, audience, and expiry with secrets supplied through
environment variables; never decode unverified tokens to obtain a role.

## Session and cookie settings

- `BETTER_AUTH_SECRET` signs/encrypts Better Auth state and must be at least 32
  characters, supplied only through the environment.
- `BETTER_AUTH_URL` is the public authentication origin used for OAuth callbacks.
  In production it is the Vercel frontend origin; Next.js rewrites `/api/*` to
  this Express server so OAuth state and session cookies remain first-party.
- `session_token` cookies are `HttpOnly`, `SameSite` configured by
  `BETTER_AUTH_COOKIE_SAME_SITE` (default `lax`), `Secure` in production or when
  the configured base URL is HTTPS, and scoped to `/`.
- The signed OAuth `state` cookie is scoped to the frontend host by the
  same-origin Vercel rewrite and is retained for 10 minutes, matching the
  verification record lifetime. State and CSRF validation remain enabled.
- Sessions expire after 7 days; cookie caching is disabled so role and blocked
  changes are reflected immediately.
- CORS is credentialed and restricted to the allowlist in
  `src/config/client-origins.ts`; unknown origins receive HTTP 403. Browser API
  requests use the same-origin Vercel rewrite, while server-side calls can use
  the Render origin directly.
- Logout calls Better Auth `/api/auth/sign-out`, which deletes the active
  session document and clears the cookie. Admin blocking also revokes all
  sessions for that user (`src/services/session-revocation.service.ts`).

## No secrets in responses

User-facing error envelopes expose only stable error codes and generic
messages. Passwords, OAuth secrets, MongoDB credentials, ImgBB keys, and raw
session tokens are never returned by Express or exposed to the browser.
