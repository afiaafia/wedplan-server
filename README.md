# WedPlan API

## Public services

All routes below are public and require no session.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/services` | Search and browse approved, active services |
| `GET` | `/api/services/featured` | Featured services for the homepage |
| `GET` | `/api/services/:id` | Get one approved, active service |

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

## CORS

Credentialed browser requests are accepted only from `https://wedplan-client-ten.vercel.app` and `http://localhost:3000`, plus explicitly configured `CLIENT_URL` and comma-separated `CORS_ALLOWED_ORIGINS` values. Wildcard, path-bearing, and unknown origins are rejected with HTTP `403`.

## Scripts

- `pnpm typecheck` — TypeScript check
- `pnpm lint` — ESLint
- `pnpm test` — Node test suite
- `pnpm build` — compile to `dist/`
- `pnpm dev` — development server
