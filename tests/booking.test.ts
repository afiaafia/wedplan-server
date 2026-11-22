import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { ObjectId, type Db } from "mongodb";
import { createApp } from "../src/app.js";
import { COLLECTIONS } from "../src/config/collections.js";
import { AppError } from "../src/errors/app-error.js";
import type { Auth } from "../src/lib/auth.js";
import { authorizeCustomerSession } from "../src/middleware/require-customer.js";
import { findServiceDetailById } from "../src/models/service.model.js";
import {
  releaseActiveBookingKey,
} from "../src/models/booking.model.js";
import { createBookingRequest } from "../src/services/booking.service.js";
import type {
  BookingDocument,
  BookingStatus,
} from "../src/types/booking.js";
import type { ServiceDocument } from "../src/types/service.js";
import {
  createBookingSchema,
  type CreateBookingBody,
} from "../src/validators/booking.validator.js";

const SERVICE_ID = "507f1f77bcf86cd799439011";
const VENDOR_ID = "507f191e810c19729de860ea";
const CUSTOMER_ID = "507f1f77bcf86cd799439012";
const OTHER_CUSTOMER_ID = "507f1f77bcf86cd799439013";

const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

type StoredBooking = BookingDocument & { _id: ObjectId };
type FakeUser = { _id: ObjectId; role?: unknown; isBlocked?: unknown };
type StoredService = ServiceDocument & { _id: ObjectId };

function serviceDocument(
  overrides: Partial<ServiceDocument> = {}
): StoredService {
  return {
    _id: new ObjectId(SERVICE_ID),
    vendorId: VENDOR_ID,
    title: "Elegant Wedding Photography",
    category: "Photography",
    description: "A full-day wedding photography package.",
    location: "Lahore",
    price: 850,
    images: ["https://i.imgbb.com/photo.png"],
    approvalStatus: "approved",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function customerUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    _id: new ObjectId(CUSTOMER_ID),
    role: "customer",
    isBlocked: false,
    ...overrides,
  };
}

function matches(document: object, filter: object): boolean {
  const values = document as Record<string, unknown>;

  return Object.entries(filter).every(([key, expected]) => {
    const actual = values[key];

    if (key === "_id") {
      if (expected instanceof ObjectId && actual instanceof ObjectId) {
        return actual.equals(expected);
      }
      return String(actual) === String(expected);
    }

    if (actual instanceof Date && expected instanceof Date) {
      return actual.getTime() === expected.getTime();
    }

    if (typeof expected === "object" && expected !== null && "$in" in expected) {
      const allowed = (expected as { $in: unknown[] }).$in;
      return allowed.includes(actual);
    }

    return actual === expected;
  });
}

function createFakeDb(options: {
  services?: StoredService[];
  users?: FakeUser[];
  bookings?: StoredBooking[];
  vendors?: Array<Record<string, unknown> & { _id: ObjectId }>;
  failInsert?: boolean;
} = {}) {
  const services = options.services ?? [serviceDocument()];
  const users = options.users ?? [customerUser()];
  const vendors = options.vendors ?? [];
  const bookings = [...(options.bookings ?? [])];

  const db = {
    collection(name: string) {
      if (name === COLLECTIONS.services) {
        return {
          findOne: async (filter: object) =>
            services.find((document) => matches(document, filter)) ?? null,
        };
      }

      if (name === "user") {
        return {
          findOne: async (filter: object) =>
            [...users, ...vendors].find((document) =>
              matches(document, filter)
            ) ?? null,
        };
      }

      if (name === COLLECTIONS.bookings) {
        return {
          countDocuments: async (filter: object) =>
            bookings.filter((document) => matches(document, filter)).length,
          insertOne: async (document: BookingDocument) => {
            if (options.failInsert) {
              throw new Error("database unavailable");
            }

            const inserted = {
              ...document,
              _id: new ObjectId(),
            } as StoredBooking;
            const duplicate = Boolean(
              inserted.activeRequestKey &&
                bookings.some(
                  (booking) =>
                    booking.activeRequestKey === inserted.activeRequestKey
                )
            );

            if (duplicate) {
              throw Object.assign(new Error("duplicate key"), { code: 11000 });
            }

            bookings.push(inserted);
            return { insertedId: inserted._id };
          },
          updateOne: async (
            filter: object,
            update: { $unset?: Record<string, string> }
          ) => {
            const found = bookings.find((booking) => matches(booking, filter));
            if (found && update.$unset) {
              for (const key of Object.keys(update.$unset)) {
                delete (found as Record<string, unknown>)[key];
              }
            }
            return { matchedCount: found ? 1 : 0 };
          },
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    },
  } as unknown as Db;

  return { db, bookings };
}

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: SERVICE_ID,
    eventDate: futureDate,
    eventLocation: "  Garden Banquet Hall  ",
    message: "  Please include the evening reception.  ",
    ...overrides,
  };
}

function mockAuth(userOverrides: Record<string, unknown> = {}): Auth {
  return {
    api: {
      getSession: async () => ({
        session: { expiresAt: "2999-01-01T00:00:00.000Z" },
        user: {
          id: CUSTOMER_ID,
          email: "customer@example.com",
          name: "Customer Name",
          role: "customer",
          isBlocked: false,
          ...userOverrides,
        },
      }),
    },
  } as unknown as Auth;
}

function unauthenticatedAuth(): Auth {
  return {
    api: {
      getSession: async () => null,
    },
  } as unknown as Auth;
}

async function startServer(
  t: TestContext,
  auth: Auth,
  db: Db
): Promise<string> {
  const server = createApp(auth, { db }).listen(0);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function postBooking(
  baseUrl: string,
  body: Record<string, unknown>,
  cookie?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function getService(
  baseUrl: string,
  id: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(
    `${baseUrl}/api/services/${encodeURIComponent(id)}`
  );

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

test("customer session authorization derives identity from the session", () => {
  const customer = authorizeCustomerSession({
    session: { expiresAt: "2999-01-01T00:00:00.000Z" },
    user: {
      id: CUSTOMER_ID,
      email: "customer@example.com",
      name: "Customer Name",
      role: "customer",
      isBlocked: false,
    },
  });

  assert.equal(customer.id, CUSTOMER_ID);
});

test("guest, vendor, admin, blocked, and expired sessions are rejected", () => {
  const session = {
    session: { expiresAt: "2999-01-01T00:00:00.000Z" },
    user: {
      id: CUSTOMER_ID,
      email: "customer@example.com",
      name: "Customer Name",
      role: "customer",
      isBlocked: false,
    },
  };

  const rejected: Array<[unknown, string]> = [
    [null, "UNAUTHORIZED"],
    [{ ...session, session: { expiresAt: "2000-01-01T00:00:00.000Z" } }, "UNAUTHORIZED"],
    [{ ...session, user: { ...session.user, role: "vendor" } }, "CUSTOMER_ACCESS_REQUIRED"],
    [{ ...session, user: { ...session.user, role: "admin" } }, "CUSTOMER_ACCESS_REQUIRED"],
    [{ ...session, user: { ...session.user, isBlocked: true } }, "ACCOUNT_BLOCKED"],
  ];

  for (const [input, code] of rejected) {
    assert.throws(
      () => authorizeCustomerSession(input),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, code);
        return true;
      }
    );
  }
});

test("booking validator rejects invalid, past, and malformed dates", () => {
  for (const eventDate of ["", "not-a-date", "2026-02-30", pastDate]) {
    const result = createBookingSchema.safeParse(bookingBody({ eventDate }));
    assert.equal(result.success, false, `expected rejection for ${eventDate}`);
  }

  const result = createBookingSchema.safeParse(bookingBody());
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.eventLocation, "Garden Banquet Hall");
    assert.equal(result.data.message, "Please include the evening reception.");
    assert.ok(result.data.eventDate instanceof Date);
  }
});

test("booking validator rejects ownership and status fields from clients", () => {
  for (const field of ["customerId", "vendorId", "status"]) {
    const result = createBookingSchema.safeParse(
      bookingBody({ [field]: "malicious-value" })
    );
    assert.equal(result.success, false, `expected rejection for ${field}`);
  }
});

test("service details include public vendor information only", async () => {
  const { db } = createFakeDb({
    vendors: [
      {
        _id: new ObjectId(VENDOR_ID),
        name: "Ayesha Khan",
        businessName: "Elegant Moments",
        image: "https://i.imgbb.com/avatar.png",
        email: "private@example.com",
        isBlocked: true,
      },
    ],
  });

  const detail = await findServiceDetailById(SERVICE_ID, db);
  assert.ok(detail);
  assert.equal(detail.title, "Elegant Wedding Photography");
  assert.deepEqual(detail.vendor, {
    id: VENDOR_ID,
    name: "Ayesha Khan",
    profileImage: "https://i.imgbb.com/avatar.png",
    businessName: "Elegant Moments",
  });
  assert.equal(JSON.stringify(detail).includes("private@example.com"), false);

  const missing = await findServiceDetailById(SERVICE_ID, createFakeDb({
    services: [serviceDocument({ approvalStatus: "pending" })],
  }).db);
  assert.equal(missing, null);
});

test("valid booking derives service and customer identity from the database and session", async () => {
  const { db, bookings } = createFakeDb();

  const booking = await createBookingRequest(
    CUSTOMER_ID,
    createBookingSchema.parse(bookingBody()) as CreateBookingBody,
    db
  );

  assert.equal(booking.status, "Pending");
  assert.equal(booking.serviceId, SERVICE_ID);
  assert.equal(booking.vendorId, VENDOR_ID);
  assert.equal(booking.eventLocation, "Garden Banquet Hall");
  assert.equal(booking.serviceTitle, "Elegant Wedding Photography");
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0]?.customerId, CUSTOMER_ID);
  assert.equal(bookings[0]?.vendorId, VENDOR_ID);
  assert.equal(bookings[0]?.status, "Pending");
});

test("missing, pending, rejected, and inactive services cannot be booked", async () => {
  const cases: Array<[StoredService[], string]> = [
    [[], "missing"],
    [[serviceDocument({ approvalStatus: "pending" })], "pending"],
    [[serviceDocument({ approvalStatus: "rejected" })], "rejected"],
    [[serviceDocument({ isActive: false })], "inactive"],
  ];

  for (const [services, label] of cases) {
    const { db } = createFakeDb({ services });
    await assert.rejects(
      () =>
        createBookingRequest(
          CUSTOMER_ID,
          createBookingSchema.parse(bookingBody()) as CreateBookingBody,
          db
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 404, label);
        assert.equal(error.code, "SERVICE_NOT_FOUND", label);
        return true;
      }
    );
  }
});

test("vendor cannot book own service and blocked customers are rechecked in the database", async () => {
  const ownService = createFakeDb({
    services: [serviceDocument({ vendorId: CUSTOMER_ID })],
  });
  await assert.rejects(
    () =>
      createBookingRequest(
        CUSTOMER_ID,
        createBookingSchema.parse(bookingBody()) as CreateBookingBody,
        ownService.db
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "CANNOT_BOOK_OWN_SERVICE");
      return true;
    }
  );

  const blocked = createFakeDb({ users: [customerUser({ isBlocked: true })] });
  await assert.rejects(
    () =>
      createBookingRequest(
        CUSTOMER_ID,
        createBookingSchema.parse(bookingBody()) as CreateBookingBody,
        blocked.db
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "ACCOUNT_BLOCKED");
      return true;
    }
  );

  const staleRole = createFakeDb({ users: [customerUser({ role: "vendor" })] });
  await assert.rejects(
    () =>
      createBookingRequest(
        CUSTOMER_ID,
        createBookingSchema.parse(bookingBody()) as CreateBookingBody,
        staleRole.db
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "CUSTOMER_ACCESS_REQUIRED");
      return true;
    }
  );
});

test("duplicate active bookings are rejected while rejected and cancelled bookings are not", async () => {
  const input = createBookingSchema.parse(bookingBody()) as CreateBookingBody;

  for (const status of ["Pending", "Accepted"] as BookingStatus[]) {
    const { db } = createFakeDb({
      bookings: [
        {
          _id: new ObjectId(),
          serviceId: SERVICE_ID,
          vendorId: VENDOR_ID,
          customerId: CUSTOMER_ID,
          eventDate: input.eventDate,
          eventLocation: "Old location",
          message: "",
          status,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    await assert.rejects(
      () => createBookingRequest(CUSTOMER_ID, input, db),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "DUPLICATE_BOOKING");
        return true;
      }
    );
  }

  for (const status of ["Rejected", "Cancelled"] as BookingStatus[]) {
    const { db, bookings } = createFakeDb({
      bookings: [
        {
          _id: new ObjectId(),
          serviceId: SERVICE_ID,
          vendorId: VENDOR_ID,
          customerId: CUSTOMER_ID,
          eventDate: input.eventDate,
          eventLocation: "Old location",
          message: "",
          status,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const booking = await createBookingRequest(CUSTOMER_ID, input, db);
    assert.equal(booking.status, "Pending");
    assert.equal(bookings.length, 2);
  }
});

test("a concurrent duplicate-key violation is reported as a duplicate request", async () => {
  const base = createFakeDb();
  const originalCollection = base.db.collection.bind(base.db);
  const racingDb = {
    collection: (name: string) => {
      const collection = originalCollection(name) as Record<string, unknown>;
      if (name !== COLLECTIONS.bookings) return collection;

      return {
        ...collection,
        countDocuments: async () => 0,
        insertOne: async () => {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        },
      };
    },
  } as unknown as Db;

  await assert.rejects(
    () =>
      createBookingRequest(
        CUSTOMER_ID,
        createBookingSchema.parse(bookingBody()) as CreateBookingBody,
        racingDb
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "DUPLICATE_BOOKING");
      return true;
    }
  );
});

test("releasing the active key allows a new request after rejection", async () => {
  const { db, bookings } = createFakeDb();
  const input = createBookingSchema.parse(bookingBody()) as CreateBookingBody;

  const first = await createBookingRequest(CUSTOMER_ID, input, db);
  await releaseActiveBookingKey(first.id, db);
  const stored = bookings[0] as StoredBooking;
  stored.status = "Rejected";

  const second = await createBookingRequest(CUSTOMER_ID, input, db);
  assert.equal(second.status, "Pending");
  assert.equal(bookings.length, 2);
});

test("a different customer or event date is not a duplicate", async () => {
  const input = createBookingSchema.parse(bookingBody()) as CreateBookingBody;
  const otherDate = createBookingSchema.parse(
    bookingBody({
      eventDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    })
  ) as CreateBookingBody;

  const seedFor = (customerId: string): StoredBooking => ({
    _id: new ObjectId(),
    serviceId: SERVICE_ID,
    vendorId: VENDOR_ID,
    customerId,
    eventDate: input.eventDate,
    eventLocation: "Old location",
    message: "",
    status: "Pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const otherCustomer = createFakeDb({ bookings: [seedFor(OTHER_CUSTOMER_ID)] });
  const otherDateDb = createFakeDb({ bookings: [seedFor(CUSTOMER_ID)] });

  assert.equal(
    (await createBookingRequest(CUSTOMER_ID, input, otherCustomer.db)).status,
    "Pending"
  );
  assert.equal(
    (await createBookingRequest(CUSTOMER_ID, otherDate, otherDateDb.db)).status,
    "Pending"
  );
});

test("POST /api/bookings creates a pending booking for a customer", async (t) => {
  const { db, bookings } = createFakeDb();
  const baseUrl = await startServer(t, mockAuth(), db);

  const result = await postBooking(baseUrl, bookingBody(), "session=abc");

  assert.equal(result.status, 201);
  assert.equal(result.body.success, true);
  const data = result.body.data as Record<string, unknown>;
  assert.equal(data.status, "Pending");
  assert.equal(data.serviceId, SERVICE_ID);
  assert.equal(data.vendorId, VENDOR_ID);
  assert.equal(data.serviceTitle, "Elegant Wedding Photography");
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0]?.customerId, CUSTOMER_ID);
});

test("POST /api/bookings rejects guests, vendors, admins, and blocked customers", async (t) => {
  const { db } = createFakeDb();
  const cases: Array<[Auth, number, string]> = [
    [
      {
        api: { getSession: async () => null },
      } as unknown as Auth,
      401,
      "UNAUTHORIZED",
    ],
    [mockAuth({ role: "vendor" }), 403, "CUSTOMER_ACCESS_REQUIRED"],
    [mockAuth({ role: "admin" }), 403, "CUSTOMER_ACCESS_REQUIRED"],
    [mockAuth({ isBlocked: true }), 403, "ACCOUNT_BLOCKED"],
  ];

  for (const [auth, status, code] of cases) {
    const baseUrl = await startServer(t, auth, db);
    const result = await postBooking(baseUrl, bookingBody());
    assert.equal(result.status, status);
    const error = result.body.error as Record<string, unknown>;
    assert.equal(error.code, code);
  }
});

test("POST /api/bookings validates input and missing services", async (t) => {
  const { db } = createFakeDb();
  const baseUrl = await startServer(t, mockAuth(), db);

  const invalidCases = [
    { body: bookingBody({ serviceId: "invalid-id" }), status: 400 },
    { body: bookingBody({ eventDate: "2026-02-30" }), status: 400 },
    { body: bookingBody({ eventLocation: "   " }), status: 400 },
    { body: bookingBody({ customerId: OTHER_CUSTOMER_ID }), status: 400 },
    { body: bookingBody({ status: "Accepted" }), status: 400 },
    { body: bookingBody({ serviceId: new ObjectId().toHexString() }), status: 404 },
  ];

  for (const { body, status } of invalidCases) {
    const result = await postBooking(baseUrl, body);
    assert.equal(result.status, status, JSON.stringify(body));
    assert.equal(result.body.success, false);
  }
});

test("POST /api/bookings returns 409 for duplicate active requests", async (t) => {
  const input = createBookingSchema.parse(bookingBody()) as CreateBookingBody;
  const { db } = createFakeDb({
    bookings: [
      {
        _id: new ObjectId(),
        serviceId: SERVICE_ID,
        vendorId: VENDOR_ID,
        customerId: CUSTOMER_ID,
        eventDate: input.eventDate,
        eventLocation: "Garden Banquet Hall",
        message: "",
        status: "Pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });
  const baseUrl = await startServer(t, mockAuth(), db);

  const result = await postBooking(baseUrl, bookingBody());
  assert.equal(result.status, 409);
  const error = result.body.error as Record<string, unknown>;
  assert.equal(error.code, "DUPLICATE_BOOKING");
});

test("POST /api/bookings maps database failures to a generic server error", async (t) => {
  const { db } = createFakeDb({ failInsert: true });
  const baseUrl = await startServer(t, mockAuth(), db);

  const result = await postBooking(baseUrl, bookingBody());
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    },
  });
});

test("GET /api/services/:id serves details to authenticated customers, vendors, and admins", async (t) => {
  const { db } = createFakeDb({
    vendors: [
      {
        _id: new ObjectId(VENDOR_ID),
        name: "Ayesha Khan",
        businessName: "Elegant Moments",
        image: "https://i.imgbb.com/avatar.png",
        email: "private@example.com",
        isBlocked: true,
      },
    ],
  });
  for (const role of ["customer", "vendor", "admin"] as const) {
    const auth = mockAuth({ role, roles: [role] });
    const baseUrl = await startServer(t, auth, db);
    const result = await getService(baseUrl, SERVICE_ID);

    assert.equal(result.status, 200, role);
    assert.equal(result.body.success, true, role);
    const data = result.body.data as Record<string, unknown>;
    assert.equal(data.title, "Elegant Wedding Photography", role);
    assert.deepEqual(data.images, ["https://i.imgbb.com/photo.png"], role);
    assert.deepEqual(
      data.vendor,
      {
        id: VENDOR_ID,
        name: "Ayesha Khan",
        businessName: "Elegant Moments",
        profileImage: "https://i.imgbb.com/avatar.png",
      },
      role
    );
    assert.equal(JSON.stringify(data).includes("private@example.com"), false, role);
  }
});

test("GET /api/services/:id returns 401 without a session and does not expose details", async (t) => {
  const { db } = createFakeDb();
  const baseUrl = await startServer(t, unauthenticatedAuth(), db);

  const result = await getService(baseUrl, SERVICE_ID);

  assert.equal(result.status, 401);
  assert.equal(result.body.success, false);
  assert.equal(result.body.data, undefined);
  assert.deepEqual(result.body.error, {
    message: "Please sign in to continue",
    code: "UNAUTHORIZED",
  });
});

test("GET /api/services/:id rejects invalid ids and hides unavailable services", async (t) => {
  const invalidDb = createFakeDb().db;
  const invalidBaseUrl = await startServer(t, mockAuth(), invalidDb);
  const invalid = await getService(invalidBaseUrl, "not-an-object-id");

  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.success, false);
  const error = invalid.body.error as Record<string, unknown>;
  assert.equal(error.code, "VALIDATION_ERROR");

  const unavailable: Array<[StoredService[], string]> = [
    [[], "missing"],
    [[serviceDocument({ approvalStatus: "pending" })], "pending"],
    [[serviceDocument({ approvalStatus: "rejected" })], "rejected"],
    [[serviceDocument({ isActive: false })], "inactive"],
  ];

  for (const [services, label] of unavailable) {
    const { db } = createFakeDb({ services });
    const baseUrl = await startServer(t, mockAuth(), db);
    const result = await getService(baseUrl, SERVICE_ID);

    assert.equal(result.status, 404, label);
    const notFound = result.body.error as Record<string, unknown>;
    assert.equal(notFound.code, "SERVICE_NOT_FOUND", label);
  }
});

test("booking validator rejects today's date as well as past dates", () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = createBookingSchema.safeParse(bookingBody({ eventDate: today }));

  assert.equal(result.success, false);
});
