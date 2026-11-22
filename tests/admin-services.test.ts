import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Db, WithId } from "mongodb";
import { ObjectId } from "mongodb";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../src/errors/app-error.js";
import type { Auth } from "../src/lib/auth.js";
import {
  authorizeAdminSession,
  requireAdmin,
} from "../src/middleware/require-admin.js";
import {
  createModerateServiceActiveHandler,
} from "../src/controllers/admin-service-actions.controller.js";
import {
  findServicesForReview,
  findServicesForReviewPage,
  setServiceApprovalStatus,
} from "../src/models/service.model.js";
import { createAdminServicesRouter } from "../src/routes/admin-services.routes.js";
import type { ServiceDocument, VendorService } from "../src/types/service.js";
import { adminServiceApprovalSchema } from "../src/validators/dashboard.validator.js";
import { setServiceApprovalSchema } from "../src/validators/service.validator.js";

const adminSession = {
  session: { expiresAt: "2999-01-01T00:00:00.000Z" },
  user: {
    id: "507f1f77bcf86cd799439011",
    email: "admin@example.com",
    name: "Platform Admin",
    role: "admin",
    isBlocked: false,
  },
};

function serviceDocument(
  overrides: Record<string, unknown> = {}
): WithId<ServiceDocument> {
  return {
    _id: new ObjectId(),
    vendorId: "507f1f77bcf86cd799439012",
    title: "Garden Photographer",
    category: "Photography",
    description: "Documenting the day",
    location: "Lagos",
    price: 450000,
    images: ["https://images.unsplash.com/photo-1"],
    approvalStatus: "pending",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as WithId<ServiceDocument>;
}

test("only active admin sessions are authorized", () => {
  assert.deepEqual(authorizeAdminSession(adminSession), {
    id: adminSession.user.id,
    email: adminSession.user.email,
    name: adminSession.user.name,
  });

  for (const [session, code] of [
    [null, "UNAUTHORIZED"],
    [{ ...adminSession, session: { expiresAt: "2020-01-01T00:00:00.000Z" } }, "UNAUTHORIZED"],
    [{ ...adminSession, user: { ...adminSession.user, role: "vendor" } }, "ADMIN_ACCESS_REQUIRED"],
    [{ ...adminSession, user: { ...adminSession.user, isBlocked: true } }, "ACCOUNT_BLOCKED"],
  ] as const) {
    assert.throws(
      () => authorizeAdminSession(session),
      (error: unknown) => error instanceof AppError && error.code === code
    );
  }
});

test("admin middleware forwards cookies and derives identity from the session", async () => {
  let forwardedCookie: string | null = null;
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        forwardedCookie = headers.get("cookie");
        return adminSession;
      },
    },
  } as unknown as Auth;
  const locals = {} as Record<string, unknown>;

  await new Promise<void>((resolve, reject) => {
    requireAdmin(auth)(
      { headers: { cookie: "better-auth.session_token=abc" } } as Request,
      { locals } as Response,
      ((error?: unknown) => (error ? reject(error) : resolve())) as NextFunction
    );
  });

  assert.equal(forwardedCookie, "better-auth.session_token=abc");
  assert.deepEqual(locals.admin, {
    id: adminSession.user.id,
    email: adminSession.user.email,
    name: adminSession.user.name,
  });
});

test("approval validator rejects ownership, activation, and unknown fields", () => {
  assert.deepEqual(setServiceApprovalSchema.parse({ approvalStatus: "approved" }), {
    approvalStatus: "approved",
  });

  for (const input of [
    { approvalStatus: "active" },
    { approvalStatus: "approved", isActive: true },
    { approvalStatus: "approved", vendorId: "someone-else" },
    {},
  ]) {
    assert.equal(setServiceApprovalSchema.safeParse(input).success, false);
  }
});

test("Admin approval accepts only a pending service decision", () => {
  assert.equal(
    adminServiceApprovalSchema.safeParse({ approvalStatus: "pending" }).success,
    false
  );
  assert.equal(
    adminServiceApprovalSchema.safeParse({ approvalStatus: "rejected" }).success,
    false
  );
  assert.equal(
    adminServiceApprovalSchema.safeParse({
      approvalStatus: "rejected",
      rejectionReason: "Please add original portfolio images",
    }).success,
    true
  );
});

test("review list returns real service documents from the services collection", async () => {
  const pending = serviceDocument();
  const approved = serviceDocument({
    _id: new ObjectId(),
    title: "Reception decor",
    approvalStatus: "approved",
  });
  const calls = { collection: "", sort: undefined as unknown };
  const db = {
    collection(name: string) {
      calls.collection = name;
      return {
        find() {
          return {
            sort(spec: unknown) {
              calls.sort = spec;
              return this;
            },
            async toArray() {
              return [approved, pending];
            },
          };
        },
      };
    },
  } as unknown as Db;

  const services = await findServicesForReview(db);

  assert.equal(calls.collection, "services");
  assert.deepEqual(calls.sort, { createdAt: -1, _id: -1 });
  assert.deepEqual(
    services.map((service) => [service.title, service.approvalStatus]),
    [
      ["Reception decor", "approved"],
      ["Garden Photographer", "pending"],
    ]
  );
});

test("approval changes only approvalStatus, never activation or ownership", async () => {
  const document = serviceDocument();
  const calls = {
    filter: undefined as unknown,
    update: undefined as unknown,
  };
  const db = {
    collection(name: string) {
      assert.equal(name, "services");
      return {
        async findOneAndUpdate(
          filter: unknown,
          update: { $set: Record<string, unknown> },
          options: unknown
        ) {
          calls.filter = filter;
          calls.update = update;
          assert.deepEqual(options, { returnDocument: "after" });
          return { ...document, approvalStatus: "approved" };
        },
      };
    },
  } as unknown as Db;

  const result = await setServiceApprovalStatus(
    document._id.toHexString(),
    "approved",
    db
  );

  assert.deepEqual(calls.filter, { _id: document._id });
  assert.deepEqual(Object.keys((calls.update as { $set: object }).$set).sort(), [
    "approvalStatus",
    "updatedAt",
  ]);
  assert.equal(result?.approvalStatus, "approved");
  assert.equal(result?.isActive, true);
  assert.equal(await setServiceApprovalStatus("not-an-object-id", "approved", db), null);
});

test("Admin service activation delegates to the capacity-enforced mutation", async () => {
  const serviceId = "65b000000000000000000001";
  const vendorId = "507f1f77bcf86cd799439012";
  const calls: unknown[][] = [];
  const service: VendorService = {
    id: serviceId,
    title: "Garden Photographer",
    category: "Photography",
    description: "Documenting the day",
    location: "Lagos",
    price: 450000,
    images: [],
    approvalStatus: "approved",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
  const handler = createModerateServiceActiveHandler({
    findServiceVendorId: async (id) => {
      calls.push(["owner", id]);
      return vendorId;
    },
    setServiceActive: async (...args) => {
      calls.push(["capacityMutation", ...args]);
      return service;
    },
  });

  let statusCode = 0;
  let body: unknown;
  await new Promise<void>((resolve, reject) => {
    const response = {
      locals: { validated: { id: serviceId, isActive: true } },
      status(value: number) {
        statusCode = value;
        return this;
      },
      json(value: unknown) {
        body = value;
        resolve();
        return this;
      },
    } as unknown as Response;

    handler({} as Request, response, (error?: unknown) => {
      if (error) reject(error);
    });
  });

  assert.equal(statusCode, 200);
  assert.deepEqual(calls, [
    ["owner", serviceId],
    ["capacityMutation", vendorId, serviceId, true],
  ]);
  assert.deepEqual(body, {
    success: true,
    message: "Service activated",
    data: service,
  });
});

test("Admin service filtering resolves vendor names and emails without exposing them publicly", async () => {
  const document = serviceDocument();
  const vendor = {
    _id: new ObjectId(document.vendorId),
    name: "Camille Studio",
    email: "camille@example.com",
  };
  let serviceFilter: Record<string, unknown> | undefined;
  const db = {
    collection(name: string) {
      if (name === "user") {
        return {
          find() {
            return { toArray: async () => [vendor] };
          },
        };
      }

      return {
        find(filter: Record<string, unknown>) {
          serviceFilter = filter;
          const cursor = {
            sort() {
              return cursor;
            },
            skip() {
              return cursor;
            },
            limit() {
              return cursor;
            },
            async toArray() {
              return [document];
            },
          };
          return cursor;
        },
        async countDocuments() {
          return 1;
        },
      };
    },
  } as unknown as Db;

  const result = await findServicesForReviewPage(
    {
      q: undefined,
      vendor: "camille@example.com",
      approvalStatus: undefined,
      isActive: "all",
      category: undefined,
      page: 1,
      limit: 10,
    },
    db
  );

  assert.deepEqual(serviceFilter?.vendorId, { $in: [vendor._id.toString()] });
  assert.equal(result.services[0]?.vendorName, vendor.name);
  assert.equal(result.services[0]?.vendorEmail, vendor.email);
});

test("admin routes reject non-admin sessions before touching the database", async (t) => {
  const app = (await import("../src/app.js")).createApp({
    api: {
      getSession: async () => ({
        ...adminSession,
        user: { ...adminSession.user, role: "customer" },
      }),
    },
  } as unknown as Auth);
  const server = app.listen(0);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const response = await fetch(`${baseUrl}/api/admin/services`);
  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "ADMIN_ACCESS_REQUIRED");

  const approvalResponse = await fetch(
    `${baseUrl}/api/admin/services/${serviceDocument()._id.toHexString()}/approval`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalStatus: "approved" }),
    }
  );
  assert.equal(approvalResponse.status, 403);
});

test("Admin dashboard rejects guests, customers, and vendors", async (t) => {
  const cases = [
    { role: "guest", session: null, status: 401 },
    {
      role: "customer",
      session: {
        ...adminSession,
        user: { ...adminSession.user, role: "customer" },
      },
      status: 403,
    },
    {
      role: "vendor",
      session: {
        ...adminSession,
        user: { ...adminSession.user, role: "vendor" },
      },
      status: 403,
    },
  ] as const;

  for (const item of cases) {
    const app = (await import("../src/app.js")).createApp({
      api: { getSession: async () => item.session },
    } as unknown as Auth);
    const server = app.listen(0);
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(`${baseUrl}/api/admin/dashboard`);

    assert.equal(response.status, item.status, item.role);
    const body = (await response.json()) as { success: boolean };
    assert.equal(body.success, false, item.role);
  }
});

test("admin router exports approval and listing routes", () => {
  const router = createAdminServicesRouter({} as Auth);
  const routes = router.stack
    .filter((layer) => "route" in layer && layer.route)
    .map((layer) => {
      const route = (layer as unknown as { route: { path: string; methods: Record<string, boolean> } }).route;
      return `${Object.keys(route.methods)[0]?.toUpperCase()} ${route.path}`;
    });

  assert.deepEqual(routes, ["GET /", "PATCH /:id/approval"]);
});
