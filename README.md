# WedPlan Server

WedPlan Server is the Express/TypeScript API for the WedPlan wedding planning platform. It provides Better Auth authentication, MongoDB-backed services and bookings, role-scoped dashboards, ImgBB image uploads, and Stripe Premium subscriptions. This is the backend deployed on Render.

- **Backend repository:** https://github.com/afiaafia/wedplan-server.git
- **Frontend repository:** https://github.com/afiaafia/wedplan-client.git
- **Live website:** https://wedplan-client-ten.vercel.app
- **Production API base URL:** https://wedplan-server-vcdp.onrender.com
- **Health endpoint:** `GET /api/health`

## Technology stack

- Node.js 24, Express 5, TypeScript, pnpm 12.4.2
- MongoDB Atlas with the official `mongodb` driver
- Better Auth 1.7 with the MongoDB adapter
- Zod validation, Helmet, CORS allowlist
- Stripe SDK (test mode in local configuration)
- Node.js built-in test runner with `tsx`

## Installation

```bash
git clone https://github.com/afiaafia/wedplan-server.git
cd wedplan-server
pnpm install
cp .env.example .env
```

Fill in `.env` with local development values, then run:

```bash
pnpm dev
```

The API listens on `PORT` (default 5000). Production compilation uses `pnpm build` and `pnpm start` (`node dist/server.js`).

## Commands

Use pnpm only.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start with `tsx watch` |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run the compiled server |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run 18 backend test files (144 tests in the latest audit) |
| `pnpm seed:featured` | Development-only featured-service seeder; refuses production unless `ALLOW_PRODUCTION_FEATURED_SEED=true` |

## API overview

| Area | Base path | Access |
| --- | --- | --- |
| Authentication/session | `/api/auth/*` | Public/auth endpoints |
| Public services | `/api/services` | Public |
| Booking requests | `/api/bookings` | Customer |
| Customer dashboard/profile | `/api/customer`, `/api/me` | Authenticated/customer |
| Vendor services/bookings/dashboard/subscription | `/api/vendor/*` | Vendor |
| Admin dashboard/users/services/bookings/transactions | `/api/admin/*` | Admin |
| Checkout | `/api/subscriptions/checkout`, `/api/payments/create-checkout-session` | Vendor |
| Stripe webhook | `/api/payments/webhook`, `/api/stripe/webhook` | Stripe signature |
| Health | `/api/health` | Public |

Error responses use `{ "success": false, "error": { "code", "message", "details?" } }`. Validation is strict: client-supplied ownership, role, approval, subscription, and status fields are rejected.

## Environment variables

See `.env.example` for the full template. Never commit real values.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV`, `PORT` | Runtime mode and API port |
| `CLIENT_URL`, `CORS_ALLOWED_ORIGINS` | Credentialed CORS allowlist; no wildcards |
| `SERVER_URL` | Canonical backend origin |
| `MONGODB_URI`, `MONGODB_DB_NAME` | Atlas connection string and database (`wedplan`) |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Auth signing secret (>= 32 chars) and public auth origin |
| `BETTER_AUTH_COOKIE_SAME_SITE` | `lax`, `strict`, or `none`; `none` requires HTTPS/Secure |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Server-only Google OAuth credentials |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` | Server-only Stripe configuration |
| `IMGBB_API_KEY` | Server-only ImgBB upload key |
| `RESEND_API_KEY`, `PASSWORD_RESET_FROM_EMAIL` | Password-reset email delivery |
| `ALLOW_PRODUCTION_FEATURED_SEED` | Explicit opt-in escape hatch for the dev seeder; leave unset |

## MongoDB setup

Use a MongoDB Atlas cluster and a database named by `MONGODB_DB_NAME` (`wedplan` by default). The application creates collections and required indexes at startup: `user`, `session`, `account`, `verification`, `services`, `bookings`, `transactions`, `webhookEvents`, and `serviceLimitCounters`. Important indexes include the browse/sort indexes, the unique partial `activeRequestKey` booking index, and unique indexes for Stripe session, subscription, and webhook event IDs. The connection is validated with a ping on startup; failed startup is logged and the process exits. The featured-services seeder is for development data only and is guarded against production use.

## Better Auth configuration

`src/lib/auth.ts` configures email/password (minimum 6 characters with upper and lower case), Google OAuth, a 7-day session with cookie cache disabled, HttpOnly/Secure cookies with configurable SameSite, trusted origins from the CORS allowlist, protected user fields, blocked-session checks, and registration role restrictions. The OAuth state cookie lasts 10 minutes, matching Better Auth's verification state lifetime. Admin cannot be self-assigned. Implicit account linking requires a locally verified email to prevent pre-registration account takeover. In production, the frontend proxies browser `/api/*` requests through Vercel to Render. Set `BETTER_AUTH_URL` to the Vercel frontend origin, `CLIENT_URL` and `CORS_ALLOWED_ORIGINS` to that same allowed frontend origin, and `BETTER_AUTH_COOKIE_SAME_SITE=lax` (Secure remains enabled on HTTPS). Google’s authorized redirect URI must be `https://wedplan-client-ten.vercel.app/api/auth/callback/google`; the Vercel rewrite forwards that callback to this server.

Express uses the configured single trusted proxy hop to resolve `req.ip`. Before forwarding an auth request to Better Auth, the server overwrites `x-wedplan-client-ip` with that resolved address; Better Auth uses only this server-generated header for rate limiting, not a caller-supplied forwarding header.

## ImgBB setup

Create an ImgBB API key and set `IMGBB_API_KEY` on the backend only. The browser sends base64 images to `/api/vendor/services/images`, `/api/me/image`, or `/api/customer/profile/image`; the backend validates file type/size and uploads to ImgBB. MongoDB stores only the returned hosted URLs.

## Stripe setup

The project uses Stripe **test mode** in local configuration (`sk_test_...`, `pk_test_...`, `whsec_...`); no live-mode keys are stored in the repository. Keep Test mode enabled for assignments and manual QA. Create a recurring monthly Price in the Stripe Dashboard, set `STRIPE_PRICE_ID`, and set `CLIENT_URL` to the deployed frontend origin for success/cancel redirects. Checkout amount, currency, and interval come from the backend Price ID; the browser cannot change them.

## Webhook configuration

Register `https://wedplan-server-vcdp.onrender.com/api/payments/webhook` in Stripe (or use `/api/stripe/webhook`, a compatibility alias). Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, and `invoice.payment_failed`. Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET` in Render; never commit it. The handler reads the raw body, verifies the signature, claims event IDs idempotently, validates plan/price/currency/vendor metadata, and only then activates Premium. For local testing use `stripe listen --forward-to localhost:5000/api/payments/webhook`.

## Deployment

The existing backend is deployed on Render. Expected build command: `pnpm install --frozen-lockfile && pnpm build`; expected start command: `pnpm start`. Set all environment variables in the Render dashboard; do not place secrets in source control. The service must allow the Vercel frontend origin in CORS and Better Auth trusted origins. No `render.yaml` is checked in, so the live service configuration must be verified in the Render dashboard.

## API reference

### Public services

All routes below are public and require no session.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/services` | Search and browse approved, active services |
| `GET` | `/api/services/featured` | Featured services for the homepage |
| `GET` | `/api/services/:id` | Get one approved, active service with its public vendor summary |

### `GET /api/services/featured`

Query parameters:

| Parameter | Type | Default | Validation |
| --- | --- | --- | --- |
| `limit` | number | `6` | Integer from `1` to `24`; invalid values return HTTP `400 VALIDATION_ERROR` |

Filtering and sorting are enforced in the database query: only documents with
`approvalStatus: "approved"` AND `isActive: true` are eligible. There is no
arbitrary featured ranking field, so eligible services are sorted newest first
(`createdAt` descending, `_id` descending as a tiebreaker). Pending, rejected,
and inactive services are never returned. Nothing is fabricated to fill the
response when fewer than `limit` services exist.

Vendors are loaded in a single batched lookup from the `user` collection. Only
`id` (from `_id`), `name`, `image` (returned as `profileImage`) and
`businessName` are projected. Missing or invalid vendor references yield
`vendor: null`. Emails, password hashes, roles, subscription fields, and other
private data are never projected or returned. Verification badges are omitted
because no vendor verification field is stored.

Response:

```json
{
  "success": true,
  "data": {
    "services": [
      {
        "id": "507f1f77bcf86cd799439013",
        "title": "Garden Photographer",
        "category": "Photography",
        "description": "Documenting the day",
        "location": "Lagos",
        "price": 450000,
        "images": ["https://images.unsplash.com/photo-1"],
        "isActive": true,
        "approvalStatus": "approved",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "vendor": {
          "id": "507f1f77bcf86cd799439011",
          "name": "Ada Events",
          "profileImage": "https://example.com/ada.jpg",
          "businessName": "Ada Weddings"
        }
      }
    ],
    "total": 1
  },
  "meta": {
    "limit": 6
  }
}
```

`total` is the number of eligible services in the database, not the number of
cards in the response. Database failures are returned as HTTP `500` with error
code `FEATURED_SERVICES_UNAVAILABLE`; they are never replaced with placeholder
records.

## Customer booking requests

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/bookings` | Submit a booking request for an approved, active service |

Requires an authenticated, non-blocked customer session. The request body is
strictly validated and accepts only `serviceId`, `eventDate`, `eventLocation`,
and optional `message`. `customerId` comes from the session and `vendorId` from
the service document; ownership, status, and identity fields supplied by the
client are rejected.

- `eventDate` must be a real calendar date (`YYYY-MM-DD` or ISO datetime) in the future.
- `eventLocation` is required and capped at 150 characters after trimming.
- `message` is optional, capped at 1000 characters, and stripped of control characters.
- Status always starts as `"Pending"`; the other values are `"Accepted"`, `"Rejected"`, and `"Cancelled"`.

Duplicate active requests (Pending or Accepted) for the same customer, service,
and event date return HTTP `409 DUPLICATE_BOOKING`. A unique partial index on
`activeRequestKey` with `partialFilterExpression: { activeRequestKey: { $exists: true } }`
provides atomic insert protection; the application pre-check provides a friendly
error. When an authorized backend action rejects or cancels a booking, it must call
`releaseActiveBookingKey(bookingId)` so a new request can be created for that date.

## Vendor service limits

- The effective plan is resolved server-side from the authenticated vendor's `user` record (`subscriptionPlan` and `subscriptionExpiresAt`). Request bodies and query parameters cannot supply a plan or vendor ID.
- `subscriptionPlan: "premium"` grants unlimited active services only while `subscriptionExpiresAt` is a valid timestamp in the future. Missing, malformed, expired, or canceled subscriptions resolve to `free`. Stripe webhooks write a valid future expiry for active subscriptions.
- Free vendors may have at most **3** services with `isActive: true`. Creating a service with `isActive: true`, activating an inactive service, and reactivating a service all check this limit.
- Capacity is reserved with an atomic per-vendor counter update inside a MongoDB transaction, so concurrent activations cannot exceed the limit.
- The fourth activation is rejected with HTTP `403` and error code `FREE_PLAN_LIMIT_REACHED`.

### Vendor endpoints

All routes below require a vendor session; every database filter is scoped to the authenticated vendor's ID.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/vendor/services` | List the vendor's services |
| `POST` | `/api/vendor/services` | Create a service (`isActive` defaults to `false`; approval always starts as `pending`) |
| `PATCH` | `/api/vendor/services/:id` | Update service details (not active state) |
| `PATCH` | `/api/vendor/services/:id/active` | Activate or deactivate a service |
| `POST` | `/api/vendor/services/images` | Upload up to 10 images to ImgBB and return their hosted URLs |
| `GET` | `/api/vendor/dashboard` | Vendor-scoped dashboard data |

The dashboard response contains real counts from the `services` and `bookings` collections:

```json
{
  "success": true,
  "data": {
    "stats": {
      "totalServices": 0,
      "activeServices": 0,
      "pendingApproval": 0,
      "totalBookings": 0
    },
    "services": [],
    "bookings": []
  }
}
```

No estimated or placeholder figures are returned.

### Downgrade behavior

When Premium expires or is canceled, the vendor's services are **not deleted or deactivated**. The account simply resolves to Free on the next request, so a vendor with more than 3 active services keeps those services and can still edit or deactivate them. Further activation attempts are rejected with `FREE_PLAN_LIMIT_REACHED` until the active count falls below 3 (or Premium is renewed). This is enforced from the persisted counter at request time, so a missed or delayed Stripe webhook still results in Free behavior after `subscriptionExpiresAt` passes.

## Admin service approval

New vendor services always start as `pending` and inactive unless the vendor
opts into activation. They are not publicly visible until an administrator
approves them. All routes below require an active admin session.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/services` | List real services awaiting or having review |
| `PATCH` | `/api/admin/services/:id/approval` | Approve or reject a `pending` service |

Approval changes `approvalStatus` and `updatedAt`, and sets or clears
`rejectionReason` for rejections. It never changes `isActive`, `vendorId`, or
other service content. Transitions back to `pending` are not exposed by this
route; vendor edits to an approved service reset it to `pending`. Approval and
activation are separate: the featured query requires both
`approvalStatus: "approved"` and `isActive: true`.

Image upload accepts JSON
`{ "images": [{ "name": "photo.jpg", "data": "<base64>" }] }` and returns
`{ "success": true, "data": { "images": [{ "url": "https://..." }] } }`. The
ImgBB key stays on the server; MongoDB stores only the returned URLs in the
service's `images` array.

## Stripe Premium payments

WedPlan Premium is a **recurring monthly Stripe subscription**. Checkout runs in
Stripe Checkout `subscription` mode. The amount, currency, and billing interval
come only from the server-configured Price ID; request bodies cannot change them.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Server-only Stripe API key. Test keys start with `sk_test_`. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for verifying webhook payloads (`whsec_...`). |
| `STRIPE_PRICE_ID` | ID of the active recurring monthly Premium Price (`price_...`). |
| `CLIENT_URL` | Frontend origin used for success/cancel redirects. |

The secret key and webhook secret are never exposed in API responses or to the
client bundle. Required values are checked when the payment module initializes;
checkout fails closed with `STRIPE_PRICE_NOT_CONFIGURED` when the Price ID is
missing.

### Stripe Dashboard setup

1. Create a Stripe account (https://dashboard.stripe.com/register) and keep
   **Test mode** enabled while developing. Test mode keys and data never affect
   real payments.
2. Create a **Product** (for example `WedPlan Premium`) and one **recurring
   monthly Price** in Stripe Billing → Products. Copy the Price ID
   (`price_...`) into `STRIPE_PRICE_ID`. The backend rejects one-time prices,
   yearly intervals, inactive prices, and prices without a positive amount.
3. Add a webhook endpoint pointing to
   `https://<your-api-domain>/api/payments/webhook` in production. Locally the
   endpoint is `http://localhost:5000/api/payments/webhook` via Stripe CLI
   forwarding. (`/api/stripe/webhook` remains supported as a compatibility
   alias.)
4. Subscribe the endpoint to `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_succeeded`, and `invoice.payment_failed`.
5. Copy the endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET`. Use the
   secret from the endpoint matching the environment; local CLI secrets differ
   from production secrets. Do not use the same webhook URL for local and
   production.

### Local testing with Stripe CLI

```bash
stripe login
stripe listen --forward-to localhost:5000/api/payments/webhook
# The CLI prints a whsec_... signing secret; put it in STRIPE_WEBHOOK_SECRET
stripe trigger checkout.session.completed
```

With test mode enabled, use Stripe's test card `4242 4242 4242 4242` with any
future expiry and CVC in Checkout. Automated tests mock the Stripe SDK and
never contact Stripe.

### Payment flow and security model

- `POST /api/subscriptions/checkout` (alias: `/api/payments/create-checkout-session`)
  requires a vendor session and rejects blocked vendors, customers, guests, and
  vendors that already have active Premium. It reuses an open Checkout session
  instead of creating duplicates, stores a `pending` transaction, and returns
  only the Checkout URL.
- Checkout redirects to
  `<CLIENT_URL>/dashboard/vendor/payment/success?session_id=...` or
  `<CLIENT_URL>/dashboard/vendor/payment/cancel`. A redirect never grants
  Premium.
- `POST /api/payments/webhook` receives the **raw** body and verifies the Stripe
  signature before any event handling. Event IDs are claimed with an atomic
  insert/unique index in the `webhookEvents` collection, so redeliveries are
  ignored. Processing verifies the session/subscription vendor metadata, plan,
  price, amount, currency, and payment status before marking the transaction
  `completed` and writing `subscriptionPlan: "premium"`,
  `subscriptionExpiresAt`, and `stripeSubscriptionId` to the existing user
  document.
- Expiry is evaluated at read time from `subscriptionExpiresAt`, so an expired
  subscription immediately falls back to Free limits without a cron job.
  Subscription deletion/inactive events write the Free plan back and clear the
  Stripe fields. Existing services are never deleted when Premium expires.
- Transaction statuses are `pending`, `completed`, `failed`, `cancelled`, and
  `refunded`. They are written only by checkout/webhook code; there is no
  endpoint that lets an admin or vendor manually mark a payment successful.

## CORS

Credentialed browser requests are accepted only from `https://wedplan-client-ten.vercel.app` and `http://localhost:3000`, plus explicitly configured `CLIENT_URL` and comma-separated `CORS_ALLOWED_ORIGINS` values. Wildcard, path-bearing, and unknown origins are rejected with HTTP `403`.

## Scripts

- `pnpm typecheck` — TypeScript check
- `pnpm lint` — ESLint
- `pnpm test` — Node test suite
- `pnpm build` — compile to `dist/`
- `pnpm dev` — development server
