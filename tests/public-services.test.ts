import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Db, WithId } from "mongodb";
import { ObjectId } from "mongodb";
import type { ErrorRequestHandler, Request, Response } from "express";
import { createApp } from "../src/app.js";
import { AppError } from "../src/errors/app-error.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import {
  buildPublicFilter,
  findPublicServices,
} from "../src/models/service.model.js";
import type { ServiceDocument } from "../src/types/service.js";
import { publicServicesQuerySchema } from "../src/validators/service.validator.js";
import type { Auth } from "../src/lib/auth.js";

type RecordValue = Record<string, unknown>;

const vendorOneId = new ObjectId("507f1f77bcf86cd799439011");
const vendorTwoId = new ObjectId("507f1f77bcf86cd799439012");

function serviceDocument(
  overrides: RecordValue = {}
): WithId<ServiceDocument> {
  return {
    _id: new ObjectId(),
    vendorId: vendorOneId.toHexString(),
    title: "Garden Photographer",
    category: "Photography",
    description: "Documenting your day",
    location: "Dhaka",
    price: 450000,
    images: ["https://i.ibb.co/example.jpg"],
    approvalStatus: "approved",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as WithId<ServiceDocument>;
}

function matches(document: RecordValue, filter: RecordValue): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") {
      return (expected as RecordValue[]).some((condition) =>
        matches(document, condition)
      );
    }

    const actual = document[key];
    if (expected && typeof expected === "object") {
      const operator = expected as RecordValue;
      if ("$in" in operator) {
        return (operator.$in as unknown[]).includes(actual);
      }
      if ("$regex" in operator) {
        const flags =
          typeof operator.$options === "string" ? operator.$options : "";
        return (
          typeof actual === "string" &&
          new RegExp(String(operator.$regex), flags).test(actual)
        );
      }
    }

    return actual === expected;
  });
}

interface FakeCursor<T> {
  sort(spec: Record<string, 1 | -1>): FakeCursor<T>;
  skip(value: number): FakeCursor<T>;
  limit(value: number): FakeCursor<T>;
  toArray(): Promise<T[]>;
}

function createCursor<T extends RecordValue>(source: T[]): FakeCursor<T> {
  let results = [...source];
  let skip = 0;
  let limit: number | undefined;

  return {
    sort(spec) {
      const keys = Object.keys(spec);
      results = [...results].sort((left, right) => {
        for (const key of keys) {
          const direction = spec[key];
          const leftValue = left[key];
          const rightValue = right[key];
          if (leftValue === rightValue) continue;
          if (leftValue === undefined) return 1;
          if (rightValue === undefined) return -1;
          return leftValue > rightValue ? direction : -direction;
        }
        return 0;
      });
      return this;
    },
    skip(value) {
      skip = value;
      return this;
    },
    limit(value) {
      limit = value;
      return this;
    },
    async toArray() {
      const end = limit === undefined ? undefined : skip + limit;
      return results.slice(skip, end);
    },
  };
}

interface FakeDbOptions {
  services: WithId<ServiceDocument>[];
  vendors?: WithId<RecordValue>[];
  servicesError?: Error;
}

function createFakeDb(options: FakeDbOptions) {
  const calls = {
    serviceFilter: undefined as RecordValue | undefined,
    serviceSort: undefined as RecordValue | undefined,
    serviceSkip: undefined as number | undefined,
    serviceLimit: undefined as number | undefined,
    countFilter: undefined as RecordValue | undefined,
    vendorFilter: undefined as RecordValue | undefined,
    vendorProjection: undefined as RecordValue | undefined,
    vendorFindCalls: 0,
  };

  const db = {
    collection(name: string) {
      if (name === "services") {
        return {
          find(filter: RecordValue) {
            calls.serviceFilter = filter;
            const eligible = options.services.filter((document) =>
              matches(document as unknown as RecordValue, filter)
            );
            const cursor = createCursor(eligible as unknown as RecordValue[]);

            return {
              sort(spec: Record<string, 1 | -1>) {
                calls.serviceSort = spec;
                cursor.sort(spec);
                return this;
              },
              skip(value: number) {
                calls.serviceSkip = value;
                cursor.skip(value);
                return this;
              },
              limit(value: number) {
                calls.serviceLimit = value;
                cursor.limit(value);
                return this;
              },
              async toArray() {
                if (options.servicesError) throw options.servicesError;
                return (await cursor.toArray()) as WithId<ServiceDocument>[];
              },
            };
          },
          async countDocuments(filter: RecordValue) {
            calls.countFilter = filter;
            if (options.servicesError) throw options.servicesError;
            return options.services.filter((document) =>
              matches(document as unknown as RecordValue, filter)
            ).length;
          },
        };
      }

      if (name === "user") {
        return {
          find(filter: RecordValue, findOptions: { projection?: RecordValue }) {
            calls.vendorFilter = filter;
            calls.vendorProjection = findOptions.projection;
            calls.vendorFindCalls += 1;

            return {
              toArray: async () => options.vendors ?? [],
            };
          },
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    },
  };

  return { db: db as unknown as Db, calls };
}

function query(overrides: RecordValue = {}) {
  const parsed = publicServicesQuerySchema.parse(overrides);
  return parsed;
}

test("public filter always requires approved and active services", () => {
  const filter = buildPublicFilter(query());

  assert.equal(filter.approvalStatus, "approved");
  assert.equal(filter.isActive, true);
});

test("listing returns only approved and active services", async () => {
  const eligible = serviceDocument({ title: "Eligible" });
  const { db } = createFakeDb({
    services: [
      eligible,
      serviceDocument({ title: "Pending", approvalStatus: "pending" }),
      serviceDocument({ title: "Rejected", approvalStatus: "rejected" }),
      serviceDocument({ title: "Inactive", isActive: false }),
    ],
    vendors: [{ _id: vendorOneId, name: "Ada Events" }],
  });

  const result = await findPublicServices(query(), db);

  assert.deepEqual(
    result.services.map((service) => service.title),
    ["Eligible"]
  );
  assert.equal(result.total, 1);
});

test("search matches service names case-insensitively and trims whitespace", async () => {
  const { db, calls } = createFakeDb({
    services: [
      serviceDocument({ title: "Golden Hour Photography" }),
      serviceDocument({ title: "Floral Design" }),
    ],
  });

  const result = await findPublicServices(query({ search: "  GOLDEN hour  " }), db);

  assert.deepEqual(
    result.services.map((service) => service.title),
    ["Golden Hour Photography"]
  );
  const filter = calls.serviceFilter as RecordValue;
  assert.deepEqual(filter.$or, [
    { title: { $regex: "GOLDEN hour", $options: "i" } },
    { description: { $regex: "GOLDEN hour", $options: "i" } },
    { category: { $regex: "GOLDEN hour", $options: "i" } },
    { location: { $regex: "GOLDEN hour", $options: "i" } },
  ]);
});

test("unsafe regex characters are escaped in search and location", () => {
  const filter = buildPublicFilter(
    query({ q: "a.b*", location: "(Dhaka)" })
  ) as RecordValue;
  const alternatives = filter.$or as RecordValue[];

  assert.deepEqual(alternatives[0], {
    title: { $regex: "a\\.b\\*", $options: "i" },
  });
  assert.deepEqual(filter.location, {
    $regex: "\\(Dhaka\\)",
    $options: "i",
  });
});

test("category filtering supports exact and multiple backend category values", async () => {
  const { db } = createFakeDb({
    services: [
      serviceDocument({ title: "Photo", category: "Photography" }),
      serviceDocument({ title: "Video", category: "Videography" }),
      serviceDocument({ title: "Catering", category: "Catering" }),
    ],
  });

  const result = await findPublicServices(
    query({ category: "Photography,Videography" }),
    db
  );

  assert.deepEqual(
    result.services.map((service) => service.title),
    ["Photo", "Video"]
  );
});

test("location filtering is case-insensitive partial matching", async () => {
  const { db } = createFakeDb({
    services: [
      serviceDocument({ title: "Dhaka vendor", location: "Dhaka" }),
      serviceDocument({ title: "Chittagong vendor", location: "Chittagong" }),
    ],
  });

  const result = await findPublicServices(query({ location: " DHA " }), db);

  assert.deepEqual(
    result.services.map((service) => service.title),
    ["Dhaka vendor"]
  );
});

test("price sorting uses numeric ascending and descending order", async () => {
  const { db, calls } = createFakeDb({
    services: [
      serviceDocument({ title: "Mid", price: 500 }),
      serviceDocument({ title: "High", price: 900 }),
      serviceDocument({ title: "Low", price: 100 }),
    ],
  });

  const ascending = await findPublicServices(query({ sort: "price_asc" }), db);
  assert.deepEqual(
    ascending.services.map((service) => service.title),
    ["Low", "Mid", "High"]
  );
  assert.deepEqual(calls.serviceSort, { price: 1, _id: 1 });

  const descending = await findPublicServices(
    query({ sortBy: "price", sortOrder: "desc" }),
    db
  );
  assert.deepEqual(
    descending.services.map((service) => service.title),
    ["High", "Mid", "Low"]
  );
  assert.deepEqual(calls.serviceSort, { price: -1, _id: -1 });
});

test("search, category, location, and sorting work together", async () => {
  const { db } = createFakeDb({
    services: [
      serviceDocument({
        title: "Dhaka Wedding Photographer",
        category: "Photography",
        location: "Dhaka",
        price: 300,
      }),
      serviceDocument({
        title: "Dhaka Photo Studio",
        category: "Photography",
        location: "Chittagong",
        price: 100,
      }),
      serviceDocument({
        title: "Dhaka Caterer",
        category: "Catering",
        location: "Dhaka",
        price: 50,
      }),
    ],
  });

  const result = await findPublicServices(
    query({
      search: "dhaka",
      category: "Photography",
      location: "dhaka",
      sort: "price_desc",
    }),
    db
  );

  assert.equal(result.total, 1);
  assert.deepEqual(
    result.services.map((service) => service.title),
    ["Dhaka Wedding Photographer"]
  );
});

test("pagination slices server-side and reports totals", async () => {
  const services = Array.from({ length: 5 }, (_, index) =>
    serviceDocument({
      title: `Service ${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)),
    })
  );
  const { db, calls } = createFakeDb({ services });

  const first = await findPublicServices(query({ page: 1, limit: 2 }), db);
  const second = await findPublicServices(query({ page: 2, limit: 2 }), db);

  assert.deepEqual(
    first.services.map((service) => service.title),
    ["Service 5", "Service 4"]
  );
  assert.deepEqual(
    second.services.map((service) => service.title),
    ["Service 3", "Service 2"]
  );
  assert.equal(first.total, 5);
  assert.equal(calls.serviceSkip, 2);
  assert.equal(calls.serviceLimit, 2);
});

test("query validation rejects invalid categories, sorting, and pagination", () => {
  assert.equal(
    publicServicesQuerySchema.safeParse({ category: "Not A Category" }).success,
    false
  );
  assert.equal(
    publicServicesQuerySchema.safeParse({ sort: "price" }).success,
    false
  );
  assert.equal(
    publicServicesQuerySchema.safeParse({ sortBy: "title" }).success,
    false
  );
  assert.equal(
    publicServicesQuerySchema.safeParse({ sortOrder: "sideways" }).success,
    false
  );
  assert.equal(publicServicesQuerySchema.safeParse({ limit: "49" }).success, false);
  assert.equal(publicServicesQuerySchema.safeParse({ page: "10001" }).success, false);

  assert.equal(query().sort, "recommended");
  assert.equal(query({ sortBy: "price" }).sort, "price_asc");
  assert.equal(query({ q: " Old ", search: " New " }).q, "Old");
});

test("empty database results return an empty list and zero total", async () => {
  const { db, calls } = createFakeDb({ services: [] });

  const result = await findPublicServices(query(), db);

  assert.deepEqual(result, { services: [], total: 0 });
  assert.equal(calls.vendorFindCalls, 0);
});

test("vendor information is batched and sensitive fields are not exposed", async () => {
  const { db, calls } = createFakeDb({
    services: [
      serviceDocument({ vendorId: vendorOneId.toHexString() }),
      serviceDocument({ vendorId: vendorTwoId.toHexString() }),
    ],
    vendors: [
      {
        _id: vendorOneId,
        name: "Ada Events",
        businessName: "Ada Weddings",
        image: "https://i.ibb.co/ada.jpg",
        email: "ada@example.com",
        passwordHash: "secret-hash",
        stripeCustomerId: "cus_secret",
        role: "vendor",
      },
      { _id: vendorTwoId, name: "Grace Decor" },
    ],
  });

  const result = await findPublicServices(query(), db);

  assert.equal(calls.vendorFindCalls, 1);
  assert.deepEqual(calls.vendorFilter, {
    _id: { $in: [vendorOneId, vendorTwoId] },
  });
  assert.deepEqual(calls.vendorProjection, {
    _id: 1,
    name: 1,
    image: 1,
    businessName: 1,
  });
  assert.deepEqual(result.services[0]?.vendor, {
    id: vendorOneId.toHexString(),
    name: "Ada Events",
    businessName: "Ada Weddings",
    profileImage: "https://i.ibb.co/ada.jpg",
  });

  const serialized = JSON.stringify(result);
  for (const field of ["email", "passwordHash", "stripeCustomerId", "role"]) {
    assert.equal(serialized.includes(field), false, `${field} was exposed`);
  }
});

test("missing vendor records and invalid ids produce null vendor data", async () => {
  const { db } = createFakeDb({
    services: [serviceDocument({ vendorId: "invalid-id" })],
  });

  const result = await findPublicServices(query(), db);

  assert.equal(result.services[0]?.vendor, null);
});

test("database errors reject and are converted to a safe 500 envelope", async () => {
  const { db } = createFakeDb({
    services: [],
    servicesError: new Error("connection string contains database-password"),
  });

  await assert.rejects(findPublicServices(query(), db));

  const res = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  } as Response & { statusCode?: number; body?: unknown };

  (errorHandler as ErrorRequestHandler)(
    new AppError(500, "SERVICES_UNAVAILABLE", "Unable to load services right now."),
    {} as Request,
    res,
    (() => {}) as never
  );

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      message: "Unable to load services right now.",
      code: "SERVICES_UNAVAILABLE",
    },
  });
  assert.equal(JSON.stringify(res.body).includes("database-password"), false);
});

test("public listing validation remains unauthenticated and detail API requires a session", async (t) => {
  const service = serviceDocument();
  const { db } = createFakeDb({
    services: [service],
    vendors: [{ _id: vendorOneId, name: "Ada Events" }],
  });
  const guestAuth = {
    api: {
      getSession: async () => null,
    },
  } as unknown as Auth;
  const server = createApp(guestAuth, { db }).listen(0);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const listing = await fetch(
    `${baseUrl}/api/services?q=Garden&category=Photography&location=Dhaka&sort=price_asc`
  );
  assert.equal(listing.status, 200);
  const listingBody = (await listing.json()) as {
    success: boolean;
    data: RecordValue[];
  };
  assert.equal(listingBody.success, true);
  assert.equal(listingBody.data.length, 1);
  assert.equal(listingBody.data[0]?.title, "Garden Photographer");

  const detail = await fetch(
    `${baseUrl}/api/services/${service._id.toHexString()}`
  );
  assert.equal(detail.status, 401);
  const detailBody = (await detail.json()) as {
    data?: unknown;
    error: { code: string };
  };
  assert.equal(detailBody.error.code, "UNAUTHORIZED");
  assert.equal(detailBody.data, undefined);

  const invalid = await fetch(`${baseUrl}/api/services?category=Invalid`);
  assert.equal(invalid.status, 400);
  const body = (await invalid.json()) as {
    success: boolean;
    error: { code: string; details: { field: string }[] };
  };
  assert.equal(body.success, false);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.details[0]?.field, "category");

  const invalidSort = await fetch(`${baseUrl}/api/services?sortBy=title`);
  assert.equal(invalidSort.status, 400);

  const invalidLimit = await fetch(`${baseUrl}/api/services?limit=500`);
  assert.equal(invalidLimit.status, 400);
});
