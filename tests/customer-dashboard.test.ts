import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { ObjectId, type Db } from "mongodb";
import { createApp } from "../src/app.js";
import { COLLECTIONS } from "../src/config/collections.js";
import type { Auth } from "../src/lib/auth.js";
import { uploadServiceImages } from "../src/services/image-upload.service.js";
import type { BookingDocument, BookingStatus } from "../src/types/booking.js";
import type { ServiceDocument } from "../src/types/service.js";

const CUSTOMER_ID = "507f1f77bcf86cd799439012";
const OTHER_CUSTOMER_ID = "507f1f77bcf86cd799439013";
const VENDOR_ID = "507f191e810c19729de860ea";
const SERVICE_ID = "507f1f77bcf86cd799439011";
const MISSING_SERVICE_ID = "507f1f77bcf86cd799439019";
const BLOCKED_CUSTOMER_ID = "507f1f77bcf86cd799439014";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=";

type StoredBooking = BookingDocument & { _id: ObjectId };
type StoredService = ServiceDocument & { _id: ObjectId };
type StoredUser = Record<string, unknown> & { _id: ObjectId };

function userDocument(id: string, overrides: Record<string, unknown> = {}): StoredUser {
  const role =
    typeof overrides.role === "string" ? overrides.role : "customer";
  return {
    _id: new ObjectId(id),
    name: "Test Customer",
    email: "customer@example.com",
    image: null,
    businessName: null,
    role: "customer",
    isBlocked: false,
    subscriptionPlan: "premium",
    subscriptionExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
    stripeSubscriptionId: "sub_private",
    passwordHash: "secret-hash",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
    roles: overrides.roles ?? [role],
  };
}

function serviceDocument(
  id = SERVICE_ID,
  overrides: Partial<ServiceDocument> = {}
): StoredService {
  return {
    _id: new ObjectId(id),
    vendorId: VENDOR_ID,
    title: "Elegant Wedding Photography",
    category: "Photography",
    description: "Full day coverage",
    location: "Lahore",
    price: 850,
    images: ["https://i.imgbb.com/wedding.png"],
    approvalStatus: "approved",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function bookingDocument(
  id: string,
  overrides: Partial<BookingDocument> = {}
): StoredBooking {
  return {
    _id: new ObjectId(id),
    serviceId: SERVICE_ID,
    vendorId: VENDOR_ID,
    customerId: CUSTOMER_ID,
    eventDate: new Date("2026-06-20T00:00:00.000Z"),
    eventLocation: "Garden Banquet Hall",
    message: "Please arrive early",
    status: "Pending",
    activeRequestKey: `${CUSTOMER_ID}|${SERVICE_ID}|2026-06-20`,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  };
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some((value) => sameValue(value, expected));
  }
  if (expected instanceof ObjectId) {
    return actual instanceof ObjectId && actual.equals(expected);
  }
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

function matches(document: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];

    if (expected && typeof expected === "object" && "$in" in expected) {
      const allowed = (expected as { $in: unknown[] }).$in;
      return allowed.some((item) => sameValue(actual, item));
    }

    if (expected && typeof expected === "object" && "$ne" in expected) {
      return !sameValue(actual, (expected as { $ne: unknown }).$ne);
    }

    return sameValue(actual, expected);
  });
}

function createCursor(documents: StoredBooking[]) {
  let current = [...documents];

  return {
    sort(spec: Record<string, 1 | -1>) {
      current = [...current].sort((left, right) => {
        for (const [key, direction] of Object.entries(spec)) {
          const a = left[key as keyof StoredBooking];
          const b = right[key as keyof StoredBooking];
          const aValue = a instanceof Date ? a.getTime() : String(a);
          const bValue = b instanceof Date ? b.getTime() : String(b);
          if (aValue < bValue) return -1 * direction;
          if (aValue > bValue) return 1 * direction;
        }
        return 0;
      });
      return this;
    },
    skip(count: number) {
      current = current.slice(count);
      return this;
    },
    limit(count: number) {
      current = current.slice(0, count);
      return this;
    },
    async toArray() {
      return current;
    },
  };
}

function createFakeDb(options: {
  users?: StoredUser[];
  services?: StoredService[];
  bookings?: StoredBooking[];
} = {}) {
  const users = options.users ?? [
    userDocument(CUSTOMER_ID),
    userDocument(OTHER_CUSTOMER_ID, {
      name: "Other Customer",
      email: "other@example.com",
    }),
    userDocument(BLOCKED_CUSTOMER_ID, { isBlocked: true }),
    userDocument(VENDOR_ID, { role: "vendor", name: "Ayesha Khan", businessName: "Elegant Moments" }),
  ];
  const services = options.services ?? [serviceDocument()];
  const bookings = [...(options.bookings ?? [])];

  const db = {
    collection(name: string) {
      if (name === "user") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            users.find((user) => matches(user, filter)) ?? null,
          find: (filter: Record<string, unknown>) => ({
            toArray: async () => users.filter((user) => matches(user, filter)),
          }),
          updateOne: async (
            filter: Record<string, unknown>,
            update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
          ) => {
            const found = users.find((user) => matches(user, filter));
            if (!found) return { matchedCount: 0 };
            if (update.$set) Object.assign(found, update.$set);
            if (update.$unset) {
              for (const key of Object.keys(update.$unset)) delete found[key];
            }
            return { matchedCount: 1 };
          },
        };
      }

      if (name === COLLECTIONS.services) {
        return {
          find: (filter: Record<string, unknown>) => ({
            toArray: async () => services.filter((service) => matches(service, filter)),
          }),
          findOne: async (filter: Record<string, unknown>) =>
            services.find((service) => matches(service, filter)) ?? null,
        };
      }

      if (name === COLLECTIONS.bookings) {
        return {
          find: (filter: Record<string, unknown>) =>
            createCursor(bookings.filter((booking) => matches(booking, filter))),
          findOne: async (filter: Record<string, unknown>) =>
            bookings.find((booking) => matches(booking, filter)) ?? null,
          countDocuments: async (
            filter: Record<string, unknown>,
            options?: { limit?: number }
          ) => {
            const matched = bookings.filter((booking) => matches(booking, filter));
            return options?.limit ? Math.min(matched.length, options.limit) : matched.length;
          },
          updateOne: async (
            filter: Record<string, unknown>,
            update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
          ) => {
            const found = bookings.find((booking) => matches(booking, filter));
            if (!found) return { matchedCount: 0 };
            if (update.$set) Object.assign(found, update.$set);
            if (update.$unset) {
              for (const key of Object.keys(update.$unset)) delete (found as Record<string, unknown>)[key];
            }
            return { matchedCount: 1 };
          },
          insertOne: async () => ({ insertedId: new ObjectId() }),
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    },
  } as unknown as Db;

  return { db, users, bookings, services };
}

function mockAuth(overrides: Record<string, unknown> = {}): Auth {
  return {
    api: {
      getSession: async () => ({
        session: { expiresAt: "2999-01-01T00:00:00.000Z" },
        user: {
          id: CUSTOMER_ID,
          email: "customer@example.com",
          name: "Test Customer",
          role: "customer",
          isBlocked: false,
          ...overrides,
        },
      }),
    },
  } as unknown as Auth;
}

const noSessionAuth = {
  api: { getSession: async () => null },
} as unknown as Auth;

async function startServer(
  t: TestContext,
  auth: Auth,
  db: Db,
  uploader?: Parameters<typeof createApp>[1]["uploadProfileImage"]
): Promise<string> {
  const server = createApp(auth, { db, uploadProfileImage: uploader }).listen(0);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function errorCode(body: Record<string, unknown>): string | undefined {
  const error = body.error as { code?: string } | undefined;
  return error?.code;
}

test("dashboard statistics and recent bookings are scoped to the session customer", async (t) => {
  const { db } = createFakeDb({
    bookings: [
      bookingDocument(new ObjectId().toHexString(), {
        status: "Pending" as BookingStatus,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
      bookingDocument(new ObjectId().toHexString(), {
        status: "Accepted" as BookingStatus,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      }),
      bookingDocument(new ObjectId().toHexString(), {
        status: "Rejected" as BookingStatus,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      }),
      bookingDocument(new ObjectId().toHexString(), {
        customerId: OTHER_CUSTOMER_ID,
        status: "Pending" as BookingStatus,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
      }),
    ],
  });
  const baseUrl = await startServer(t, mockAuth(), db);

  const response = await request(baseUrl, "GET", "/api/customer/dashboard?limit=2");
  assert.equal(response.status, 200);

  const data = response.body.data as {
    stats: Record<string, number>;
    bookings: Array<Record<string, unknown>>;
  };
  assert.deepEqual(data.stats, {
    totalBookings: 3,
    pendingBookings: 1,
    acceptedBookings: 1,
    rejectedBookings: 1,
  });
  assert.equal(data.bookings.length, 2);
  assert.equal((data.bookings[0] as { status: string }).status, "Rejected");
  assert.equal((data.bookings[1] as { status: string }).status, "Accepted");
  assert.equal(
    ((data.bookings[0] as { service: { title: string } }).service.title),
    "Elegant Wedding Photography"
  );
  assert.equal(
    ((data.bookings[0] as { vendor: { businessName: string } }).vendor.businessName),
    "Elegant Moments"
  );
  assert.equal((response.body.meta as { recentLimit: number }).recentLimit, 2);
});

test("booking history supports status filters, pagination, and parameter validation", async (t) => {
  const { db } = createFakeDb({
    bookings: [
      bookingDocument("507f1f77bcf86cd799439101", {
        status: "Pending",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
      bookingDocument("507f1f77bcf86cd799439102", {
        status: "Pending",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      }),
      bookingDocument("507f1f77bcf86cd799439103", {
        status: "Accepted",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      }),
      bookingDocument("507f1f77bcf86cd799439104", {
        status: "Rejected",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
      }),
      bookingDocument("507f1f77bcf86cd799439105", {
        status: "Cancelled",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ],
  });
  const baseUrl = await startServer(t, mockAuth(), db);

  const all = await request(baseUrl, "GET", "/api/customer/bookings?page=2&limit=2");
  assert.equal(all.status, 200);
  assert.equal((all.body.data as unknown[]).length, 2);
  assert.deepEqual(all.body.meta, {
    page: 2,
    limit: 2,
    total: 5,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });

  const pending = await request(baseUrl, "GET", "/api/customer/bookings?status=pending");
  assert.equal(pending.status, 200);
  assert.equal((pending.body.data as unknown[]).length, 2);
  assert.ok(
    (pending.body.data as Array<{ status: string }>).every((booking) => booking.status === "Pending")
  );

  const cancelled = await request(baseUrl, "GET", "/api/customer/bookings?status=cancelled");
  assert.equal((cancelled.body.data as Array<{ status: string }>)[0]?.status, "Cancelled");

  for (const path of [
    "/api/customer/bookings?page=0",
    "/api/customer/bookings?status=unknown",
    "/api/customer/bookings?limit=100",
    "/api/customer/bookings?customerId=507f191e810c19729de860ea",
  ]) {
    const invalid = await request(baseUrl, "GET", path);
    assert.equal(invalid.status, 400, path);
    assert.equal(errorCode(invalid.body), "VALIDATION_ERROR", path);
  }
});

test("customers can view only their own booking details and missing references are graceful", async (t) => {
  const firstId = new ObjectId().toHexString();
  const otherId = new ObjectId().toHexString();
  const missingReferenceId = new ObjectId().toHexString();
  const { db } = createFakeDb({
    bookings: [
      bookingDocument(firstId),
      bookingDocument(otherId, { customerId: OTHER_CUSTOMER_ID }),
      bookingDocument(missingReferenceId, {
        serviceId: MISSING_SERVICE_ID,
        vendorId: MISSING_SERVICE_ID,
      }),
    ],
  });
  const baseUrl = await startServer(t, mockAuth(), db);

  const own = await request(baseUrl, "GET", `/api/customer/bookings/${firstId}`);
  assert.equal(own.status, 200);
  const detail = own.body.data as Record<string, unknown>;
  assert.equal((detail.service as { image: string }).image, "https://i.imgbb.com/wedding.png");
  assert.equal((detail.service as { category: string }).category, "Photography");
  assert.equal((detail.service as { price: number }).price, 850);
  assert.equal((detail.vendor as { name: string }).name, "Ayesha Khan");
  assert.equal(detail.message, "Please arrive early");

  const other = await request(baseUrl, "GET", `/api/customer/bookings/${otherId}`);
  assert.equal(other.status, 404);
  assert.equal(errorCode(other.body), "BOOKING_NOT_FOUND");

  const graceful = await request(baseUrl, "GET", `/api/customer/bookings/${missingReferenceId}`);
  assert.equal(graceful.status, 200);
  const gracefulDetail = graceful.body.data as Record<string, unknown>;
  assert.equal(gracefulDetail.service, null);
  assert.equal(gracefulDetail.vendor, null);

  for (const invalidId of ["abc", "507f1f77bcf86cd79943901z"]) {
    const response = await request(baseUrl, "GET", `/api/customer/bookings/${invalidId}`);
    assert.equal(response.status, 400);
    assert.equal(errorCode(response.body), "VALIDATION_ERROR");
  }
});

test("customers can cancel only their own pending bookings", async (t) => {
  const pendingId = new ObjectId().toHexString();
  const acceptedId = new ObjectId().toHexString();
  const otherId = new ObjectId().toHexString();
  const { db, bookings } = createFakeDb({
    bookings: [
      bookingDocument(pendingId, { status: "Pending" }),
      bookingDocument(acceptedId, { status: "Accepted" }),
      bookingDocument(otherId, { customerId: OTHER_CUSTOMER_ID, status: "Pending" }),
    ],
  });
  const baseUrl = await startServer(t, mockAuth(), db);

  const cancelled = await request(baseUrl, "POST", `/api/customer/bookings/${pendingId}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal((cancelled.body.data as { status: string }).status, "Cancelled");
  assert.equal(bookings.find((booking) => booking._id.toHexString() === pendingId)?.status, "Cancelled");
  assert.equal(
    "activeRequestKey" in (bookings.find((booking) => booking._id.toHexString() === pendingId) ?? {}),
    false
  );

  const accepted = await request(baseUrl, "POST", `/api/customer/bookings/${acceptedId}/cancel`);
  assert.equal(accepted.status, 409);
  assert.equal(errorCode(accepted.body), "BOOKING_NOT_CANCELLABLE");
  assert.equal(bookings.find((booking) => booking._id.toHexString() === acceptedId)?.status, "Accepted");

  const other = await request(baseUrl, "POST", `/api/customer/bookings/${otherId}/cancel`);
  assert.equal(other.status, 404);
  assert.equal(errorCode(other.body), "BOOKING_NOT_FOUND");
  assert.equal(bookings.find((booking) => booking._id.toHexString() === otherId)?.status, "Pending");

  const invalid = await request(baseUrl, "POST", "/api/customer/bookings/not-an-id/cancel");
  assert.equal(invalid.status, 400);
  assert.equal(errorCode(invalid.body), "VALIDATION_ERROR");
});

test("non-customers, blocked customers, and unauthenticated users cannot access customer endpoints", async (t) => {
  const { db } = createFakeDb();
  const paths = [
    "/api/customer/dashboard",
    "/api/customer/bookings",
    "/api/customer/profile",
  ];

  for (const auth of [mockAuth({ role: "vendor" }), mockAuth({ role: "admin" })]) {
    const baseUrl = await startServer(t, auth, db);
    for (const path of paths) {
      const response = await request(baseUrl, "GET", path);
      assert.equal(response.status, 403, path);
      assert.equal(errorCode(response.body), "CUSTOMER_ACCESS_REQUIRED", path);
    }
  }

  const blockedUrl = await startServer(t, mockAuth({ isBlocked: true }), db);
  const blocked = await request(blockedUrl, "GET", "/api/customer/dashboard");
  assert.equal(blocked.status, 403);
  assert.equal(errorCode(blocked.body), "ACCOUNT_BLOCKED");

  const anonymousUrl = await startServer(t, noSessionAuth, db);
  const anonymous = await request(anonymousUrl, "GET", "/api/customer/dashboard");
  assert.equal(anonymous.status, 401);
  assert.equal(errorCode(anonymous.body), "UNAUTHORIZED");

  const staleDb = createFakeDb({
    users: [userDocument(CUSTOMER_ID, { role: "vendor", roles: ["vendor"] })],
  });
  const staleUrl = await startServer(t, mockAuth(), staleDb.db);
  const stale = await request(staleUrl, "GET", "/api/customer/dashboard");
  assert.equal(stale.status, 403);
  assert.equal(errorCode(stale.body), "CUSTOMER_ACCESS_REQUIRED");
});

test("profile updates permit only explicitly allowed fields", async (t) => {
  const { db, users } = createFakeDb();
  const baseUrl = await startServer(t, mockAuth(), db);

  const profile = await request(baseUrl, "GET", "/api/customer/profile");
  assert.equal(profile.status, 200);
  const profileData = profile.body.data as Record<string, unknown>;
  assert.equal(profileData.name, "Test Customer");
  assert.equal(profileData.email, "customer@example.com");
  assert.equal(JSON.stringify(profile.body).includes("passwordHash"), false);
  assert.equal(JSON.stringify(profile.body).includes("stripeSubscriptionId"), false);
  assert.equal(JSON.stringify(profileData).includes("subscriptionPlan"), false);
  assert.equal(JSON.stringify(profileData).includes("isBlocked"), false);

  const updated = await request(baseUrl, "PATCH", "/api/customer/profile", {
    name: "  New Customer Name  ",
  });
  assert.equal(updated.status, 200);
  assert.equal((updated.body.data as { name: string }).name, "New Customer Name");
  const customer = users.find((user) => user._id.toHexString() === CUSTOMER_ID);
  assert.equal(customer?.name, "New Customer Name");

  for (const body of [
    { name: "Hacked", role: "admin" },
    { name: "Hacked", isBlocked: true },
    { name: "Hacked", subscriptionPlan: "premium", subscriptionExpiresAt: "2999-01-01" },
    { name: "Hacked", image: "https://example.com/avatar.png" },
    { role: "admin" },
  ]) {
    const rejected = await request(baseUrl, "PATCH", "/api/customer/profile", body);
    assert.equal(rejected.status, 400, JSON.stringify(body));
    assert.equal(errorCode(rejected.body), "VALIDATION_ERROR", JSON.stringify(body));
  }

  assert.equal(customer?.name, "New Customer Name");
  assert.equal(customer?.role, "customer");
  assert.equal(customer?.isBlocked, false);
  assert.equal(customer?.image, null);
});

test("profile image upload validates files, stores the ImgBB URL, and keeps the API key server-side", async (t) => {
  const previousKey = process.env.IMGBB_API_KEY;
  process.env.IMGBB_API_KEY = "test-imgbb-private-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.IMGBB_API_KEY;
    else process.env.IMGBB_API_KEY = previousKey;
  });

  const requests: FormData[] = [];
  const uploader: Parameters<typeof createApp>[1]["uploadProfileImage"] = (input, apiKey) => {
    return uploadServiceImages(input, apiKey, (async (_url, init) => {
      requests.push(init?.body as FormData);
      return new Response(
        JSON.stringify({ success: true, data: { url: "https://i.imgbb.com/avatar-new.png" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch);
  };

  const { db, users } = createFakeDb();
  const baseUrl = await startServer(t, mockAuth(), db, uploader);

  const uploaded = await request(baseUrl, "POST", "/api/customer/profile/image", {
    image: { name: "avatar.png", data: PNG_BASE64 },
  });
  assert.equal(uploaded.status, 200);
  assert.equal(
    (uploaded.body.data as { image: string }).image,
    "https://i.imgbb.com/avatar-new.png"
  );
  assert.equal(requests[0]?.get("key"), "test-imgbb-private-key");
  assert.equal(JSON.stringify(uploaded.body).includes("test-imgbb-private-key"), false);
  assert.equal(
    users.find((user) => user._id.toHexString() === CUSTOMER_ID)?.image,
    "https://i.imgbb.com/avatar-new.png"
  );

  for (const body of [
    { image: { data: "not-an-image" } },
    { image: { data: Buffer.from("hello world").toString("base64") } },
    { image: { data: PNG_BASE64, role: "admin" } },
    { image: "not-an-object" },
    { name: "avatar.png", data: PNG_BASE64 },
  ]) {
    const invalid = await request(baseUrl, "POST", "/api/customer/profile/image", body);
    assert.equal(invalid.status, 400, JSON.stringify(body));
    assert.equal(errorCode(invalid.body), "VALIDATION_ERROR", JSON.stringify(body));
  }
  assert.equal(requests.length, 1);
});

test("customers cannot set booking status through request bodies or delete bookings", async (t) => {
  const pendingId = new ObjectId().toHexString();
  const { db, bookings } = createFakeDb({
    bookings: [bookingDocument(pendingId, { status: "Pending" })],
  });
  const baseUrl = await startServer(t, mockAuth(), db);

  const cancelled = await request(
    baseUrl,
    "POST",
    `/api/customer/bookings/${pendingId}/cancel`,
    { status: "Accepted", customerId: OTHER_CUSTOMER_ID }
  );
  assert.equal(cancelled.status, 200);
  assert.equal((cancelled.body.data as { status: string }).status, "Cancelled");
  assert.equal(bookings[0]?.status, "Cancelled");

  const deletion = await fetch(
    `${baseUrl}/api/customer/bookings/${pendingId}`,
    { method: "DELETE" }
  );
  assert.equal(deletion.status, 404);
  assert.equal(bookings.length, 1);
});
