import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Db, WithId } from "mongodb";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import {
  FEATURED_SERVICES_ERROR_CODE,
  getFeaturedServices,
  normalizeFeaturedLimit,
} from "../src/services/featured-services.service.js";
import {
  buildFeaturedFilter,
  findFeaturedServices,
} from "../src/models/service.model.js";
import type { ServiceDocument } from "../src/types/service.js";
import { featuredServicesQuerySchema } from "../src/validators/service.validator.js";
import { AppError } from "../src/errors/app-error.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import type { ErrorRequestHandler, Request, Response } from "express";
import type { Auth } from "../src/lib/auth.js";

const vendorOneId = new ObjectId("507f1f77bcf86cd799439011");
const vendorTwoId = new ObjectId("507f1f77bcf86cd799439012");

function serviceDocument(
  overrides: Record<string, unknown> = {}
): WithId<ServiceDocument> {
  return {
    _id: new ObjectId(),
    vendorId: vendorOneId.toHexString(),
    title: "Garden Photographer",
    category: "Photography",
    description: "Documenting the day",
    location: "Lagos",
    price: 450000,
    images: ["https://images.unsplash.com/photo-1"],
    approvalStatus: "approved",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as WithId<ServiceDocument>;
}

interface FakeCursor<T> {
  sort(spec: Record<string, 1 | -1>): FakeCursor<T>;
  limit(value: number): FakeCursor<T>;
  toArray(): Promise<T[]>;
}

function createCursor<T>(source: T[]): FakeCursor<T> {
  let results = [...source];
  let limit: number | undefined;

  return {
    sort(spec) {
      const keys = Object.keys(spec) as (keyof T)[];
      results = [...results].sort((left, right) => {
        for (const key of keys) {
          const direction = spec[key as string] as 1 | -1;
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
    limit(value) {
      limit = value;
      return this;
    },
    async toArray() {
      return limit === undefined ? results : results.slice(0, limit);
    },
  };
}

interface FakeDbOptions {
  services: WithId<ServiceDocument>[];
  vendors?: WithId<Record<string, unknown>>[];
  servicesError?: Error;
}

function createFakeDb(options: FakeDbOptions) {
  const calls = {
    serviceFilter: undefined as unknown,
    serviceProjection: undefined as unknown,
    serviceSort: undefined as unknown,
    serviceLimit: undefined as number | undefined,
    countFilter: undefined as unknown,
    vendorFilter: undefined as unknown,
    vendorProjection: undefined as unknown,
    vendorFindCalls: 0,
  };

  const db = {
    collection(name: string) {
      if (name === "services") {
        return {
          find(
            filter: Record<string, unknown>,
            findOptions: { projection?: unknown } = {}
          ) {
            calls.serviceFilter = filter;
            calls.serviceProjection = findOptions.projection;
            if (options.servicesError) {
              return {
                sort() {
                  return this;
                },
                limit() {
                  return this;
                },
                async toArray() {
                  throw options.servicesError;
                },
              };
            }

            const eligible = options.services.filter(
              (document) =>
                document.approvalStatus === filter.approvalStatus &&
                document.isActive === filter.isActive
            );
            const cursor = createCursor(eligible);

            return {
              sort(spec: Record<string, 1 | -1>) {
                calls.serviceSort = spec;
                cursor.sort(spec);
                return this;
              },
              limit(value: number) {
                calls.serviceLimit = value;
                cursor.limit(value);
                return this;
              },
              toArray: () => cursor.toArray(),
            };
          },
          async countDocuments(filter: unknown) {
            calls.countFilter = filter;
            if (options.servicesError) throw options.servicesError;

            return options.services.filter(
              (document) =>
                document.approvalStatus === "approved" && document.isActive
            ).length;
          },
        };
      }

      if (name === "user") {
        return {
          find(filter: unknown, findOptions: { projection?: unknown } = {}) {
            calls.vendorFilter = filter;
            calls.vendorProjection = findOptions.projection;
            calls.vendorFindCalls += 1;

            return {
              toArray: () =>
                createCursor(options.vendors ?? []).toArray(),
            };
          },
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    },
  };

  return { db: db as unknown as Db, calls };
}

test("featured filter requires approved and active services", () => {
  assert.deepEqual(buildFeaturedFilter(), {
    approvalStatus: "approved",
    isActive: true,
  });
});

test("only approved and active services are returned", async () => {
  const eligible = serviceDocument({ title: "Eligible" });
  const pending = serviceDocument({
    title: "Pending",
    approvalStatus: "pending",
  });
  const rejected = serviceDocument({
    title: "Rejected",
    approvalStatus: "rejected",
  });
  const inactive = serviceDocument({ title: "Inactive", isActive: false });

  const { db, calls } = createFakeDb({
    services: [pending, rejected, inactive, eligible],
  });

  const result = await findFeaturedServices(6, db);

  assert.deepEqual(result.services.map((service) => service.title), [
    "Eligible",
  ]);
  assert.equal(result.total, 1);
  assert.deepEqual(calls.serviceFilter, {
    approvalStatus: "approved",
    isActive: true,
  });
  assert.deepEqual(calls.countFilter, {
    approvalStatus: "approved",
    isActive: true,
  });
});

test("newest eligible services are returned up to the requested limit", async () => {
  const services = Array.from({ length: 8 }, (_, index) =>
    serviceDocument({
      title: `Service ${index}`,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)),
    })
  );
  const { db, calls } = createFakeDb({ services });

  const result = await findFeaturedServices(6, db);

  assert.deepEqual(
    result.services.map((service) => service.title),
    ["Service 7", "Service 6", "Service 5", "Service 4", "Service 3", "Service 2"]
  );
  assert.equal(result.total, 8);
  assert.deepEqual(calls.serviceSort, { createdAt: -1, _id: -1 });
  assert.equal(calls.serviceLimit, 6);
  assert.deepEqual(calls.serviceProjection, {
    _id: 1,
    title: 1,
    category: 1,
    description: 1,
    location: 1,
    price: 1,
    images: 1,
    createdAt: 1,
    vendorId: 1,
    approvalStatus: 1,
    isActive: 1,
  });
});

test("vendor information is populated with one batched lookup", async () => {
  const { db, calls } = createFakeDb({
    services: [
      serviceDocument({ vendorId: vendorOneId.toHexString() }),
      serviceDocument({
        _id: new ObjectId(),
        vendorId: vendorTwoId.toHexString(),
      }),
    ],
    vendors: [
      {
        _id: vendorOneId,
        name: "Ada Events",
        image: "https://example.com/ada.jpg",
        businessName: "Ada Weddings",
      } as WithId<Record<string, unknown>>,
      {
        _id: vendorTwoId,
        name: "Grace Decor",
      } as WithId<Record<string, unknown>>,
    ],
  });

  const result = await findFeaturedServices(6, db);

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
  assert.deepEqual(result.services.map((service) => service.vendor), [
    {
      id: vendorOneId.toHexString(),
      name: "Ada Events",
      profileImage: "https://example.com/ada.jpg",
      businessName: "Ada Weddings",
    },
    {
      id: vendorTwoId.toHexString(),
      name: "Grace Decor",
    },
  ]);
});

test("missing or invalid vendor relationships are handled safely", async () => {
  const { db, calls } = createFakeDb({
    services: [
      serviceDocument({ vendorId: "not-an-object-id" }),
      serviceDocument({ vendorId: vendorTwoId.toHexString() }),
    ],
    vendors: [],
  });

  const result = await findFeaturedServices(6, db);

  assert.deepEqual(calls.vendorFilter, {
    _id: { $in: [vendorTwoId] },
  });
  assert.deepEqual(
    result.services.map((service) => service.vendor),
    [null, null]
  );
});

test("sensitive vendor fields are never exposed", async () => {
  const { db } = createFakeDb({
    services: [serviceDocument()],
    vendors: [
      {
        _id: vendorOneId,
        name: "Ada Events",
        email: "ada@example.com",
        passwordHash: "super-secret-hash",
        stripeSubscriptionId: "sub_secret",
        subscriptionPlan: "premium",
        role: "vendor",
      } as WithId<Record<string, unknown>>,
    ],
  });

  const result = await findFeaturedServices(6, db);
  const serialized = JSON.stringify(result);

  for (const field of [
    "email",
    "passwordHash",
    "stripeSubscriptionId",
    "subscriptionPlan",
    "role",
  ]) {
    assert.equal(serialized.includes(field), false, `${field} was exposed`);
  }
});

test("empty database results return an empty services array and zero total", async () => {
  const { db, calls } = createFakeDb({ services: [] });

  const result = await findFeaturedServices(6, db);

  assert.deepEqual(result, { services: [], total: 0 });
  assert.equal(calls.vendorFindCalls, 0);
});

test("limit query validation uses default, accepts larger values, and caps abuse", () => {
  assert.deepEqual(featuredServicesQuerySchema.parse({}), { limit: 6 });
  assert.deepEqual(
    featuredServicesQuerySchema.parse({ limit: "12" }),
    { limit: 12 }
  );
  assert.deepEqual(
    featuredServicesQuerySchema.parse({ limit: "24" }),
    { limit: 24 }
  );

  for (const invalid of ["0", "25", "-1", "abc"]) {
    assert.equal(
      featuredServicesQuerySchema.safeParse({ limit: invalid }).success,
      false,
      `${invalid} should be rejected`
    );
  }
});

test("service layer clamps limits and slices results", async () => {
  assert.equal(normalizeFeaturedLimit(Number.NaN), 6);
  assert.equal(normalizeFeaturedLimit(0), 1);
  assert.equal(normalizeFeaturedLimit(1000), 24);

  const result = await getFeaturedServices(1000, async (limit) => {
    assert.equal(limit, 24);
    return {
      services: Array.from({ length: 30 }, () => serviceDocument()),
      total: 30,
    };
  });

  assert.equal(result.services.length, 24);
  assert.equal(result.total, 30);
});

test("database errors are converted to a public 500 error response", async () => {
  const failure = new Error("database unavailable");
  const { db } = createFakeDb({ services: [], servicesError: failure });

  await assert.rejects(
    getFeaturedServices(6, (limit) => findFeaturedServices(limit, db)),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 500);
      assert.equal(error.code, FEATURED_SERVICES_ERROR_CODE);
      return true;
    }
  );

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
    new AppError(500, FEATURED_SERVICES_ERROR_CODE, "Unable to load featured services right now"),
    {} as Request,
    res,
    (() => {}) as never
  );

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      message: "Unable to load featured services right now",
      code: FEATURED_SERVICES_ERROR_CODE,
    },
  });
});

test("featured endpoint is public and validates limit before database access", async (t) => {
  const server = createApp({} as Auth).listen(0);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${baseUrl}/api/services/featured?limit=25`);
  assert.equal(response.status, 400);
  const body = (await response.json()) as {
    success: boolean;
    error: { code: string; details: { field: string }[] };
  };
  assert.equal(body.success, false);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.details[0]?.field, "limit");

  const publicRoute = await fetch(
    `${baseUrl}/api/services/featured?limit=0`
  );
  assert.equal(publicRoute.status, 400);
  assert.equal((await publicRoute.json()).error.code, "VALIDATION_ERROR");
});
