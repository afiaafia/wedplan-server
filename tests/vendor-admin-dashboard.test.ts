import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { ObjectId, type Db } from "mongodb";
import { AppError } from "../src/errors/app-error.js";
import type { Auth } from "../src/lib/auth.js";
import {
  getAdminDashboardStats,
  sumSuccessfulTransactionAmounts,
} from "../src/models/admin-dashboard.model.js";
import {
  findVendorBookings,
  updateVendorBookingStatus,
} from "../src/models/booking.model.js";
import { getVendorDashboardSummary } from "../src/models/dashboard.model.js";
import {
  setServiceApprovalStatus,
  updateVendorServiceWithApproval,
} from "../src/models/service.model.js";
import { setUserBlocked } from "../src/models/user.model.js";
import { provisionInitialAdmin } from "../src/services/admin-provisioning.service.js";

type StoredDocument = Record<string, unknown> & { _id: ObjectId };

function matches(document: StoredDocument, filter: Record<string, unknown>) {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "$or") {
      const alternatives = expected as Record<string, unknown>[];
      if (!alternatives.some((alternative) => matches(document, alternative))) {
        return false;
      }
      continue;
    }

    const actual = document[key];
    if (expected && typeof expected === "object" && "$ne" in expected) {
      if (String(actual) === String((expected as { $ne: unknown }).$ne)) {
        return false;
      }
      continue;
    }
    if (expected && typeof expected === "object" && "$in" in expected) {
      const values = (expected as { $in: unknown[] }).$in.map(String);
      if (!values.includes(String(actual))) return false;
      continue;
    }
    if (expected && typeof expected === "object" && "$exists" in expected) {
      const exists = (expected as { $exists: boolean }).$exists;
      if ((actual !== undefined) !== exists) return false;
      continue;
    }
    if (String(actual) !== String(expected)) return false;
  }
  return true;
}

function createFakeDb(tables: Record<string, StoredDocument[]> = {}) {
  return {
    collection(name: string) {
      const documents = tables[name] ?? [];
      return {
        find(filter: Record<string, unknown> = {}) {
          let result = documents.filter((document) => matches(document, filter));
          const cursor = {
            sort() {
              return cursor;
            },
            skip(count: number) {
              result = result.slice(count);
              return cursor;
            },
            limit(count: number) {
              result = result.slice(0, count);
              return cursor;
            },
            async toArray() {
              return result;
            },
          };
          return cursor;
        },
        async findOne(filter: Record<string, unknown> = {}) {
          return documents.find((document) => matches(document, filter)) ?? null;
        },
        async countDocuments(filter: Record<string, unknown> = {}) {
          return documents.filter((document) => matches(document, filter)).length;
        },
        async findOneAndUpdate(
          filter: Record<string, unknown>,
          update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
        ) {
          const index = documents.findIndex((document) => matches(document, filter));
          if (index === -1) return null;
          const next = { ...documents[index], ...(update.$set ?? {}) } as StoredDocument;
          for (const key of Object.keys(update.$unset ?? {})) delete next[key];
          documents[index] = next;
          return next;
        },
        async updateOne(
          filter: Record<string, unknown>,
          update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
        ) {
          const index = documents.findIndex((document) => matches(document, filter));
          if (index === -1) return { matchedCount: 0 };
          const next = { ...documents[index], ...(update.$set ?? {}) } as StoredDocument;
          for (const key of Object.keys(update.$unset ?? {})) delete next[key];
          documents[index] = next;
          return { matchedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

function bookingDocument(overrides: Record<string, unknown> = {}): StoredDocument {
  return {
    _id: new ObjectId(),
    vendorId: "507f1f77bcf86cd799439012",
    customerId: "507f1f77bcf86cd799439013",
    serviceId: "507f1f77bcf86cd799439014",
    eventDate: new Date("2026-06-01T00:00:00.000Z"),
    eventLocation: "Lagos",
    message: "Please arrive early",
    status: "Pending",
    activeRequestKey: "customer|service|2026-06-01",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function serviceDocument(overrides: Record<string, unknown> = {}): StoredDocument {
  return {
    _id: new ObjectId(),
    vendorId: "507f1f77bcf86cd799439012",
    title: "Wedding photography",
    category: "Photography",
    description: "Full day coverage",
    location: "Lagos",
    price: 500000,
    images: ["https://images.example.com/photo.jpg"],
    approvalStatus: "approved",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as StoredDocument;
}

test("vendor dashboard summary adds booking and subscription metrics", async () => {
  const summary = await getVendorDashboardSummary("507f1f77bcf86cd799439012", {
    countTotal: async () => 8,
    countActive: async () => 2,
    countPending: async () => 3,
    countBookings: async () => 11,
    countPendingBookings: async () => 4,
    countAcceptedBookings: async () => 5,
    resolvePlan: async () => "premium",
  });

  assert.deepEqual(summary, {
    totalServices: 8,
    activeServices: 2,
    pendingApproval: 3,
    totalBookings: 11,
    pendingBookingRequests: 4,
    acceptedBookings: 5,
    currentSubscriptionPlan: "premium",
    activeServiceLimit: null,
  });
});

test("vendor bookings are scoped, filterable, and paginated", async () => {
  const vendorId = "507f1f77bcf86cd799439012";
  const bookings = [
    bookingDocument({ status: "Pending" }),
    bookingDocument({ status: "Accepted" }),
    bookingDocument({ vendorId: "507f1f77bcf86cd799439099", status: "Pending" }),
  ];
  const db = createFakeDb({ bookings });

  const result = await findVendorBookings(
    vendorId,
    {
      status: "Pending",
      serviceId: undefined,
      page: 1,
      limit: 10,
    },
    db
  );

  assert.equal(result.bookings.length, 1);
  assert.equal(result.bookings[0]?.customerId, "507f1f77bcf86cd799439013");
  assert.equal(result.meta.total, 1);
});

test("vendors can only process their own pending bookings and rejection frees the active key", async () => {
  const vendorId = "507f1f77bcf86cd799439012";
  const booking = bookingDocument();
  const db = createFakeDb({ bookings: [booking] });

  const rejected = await updateVendorBookingStatus(vendorId, booking._id.toHexString(), "reject", db);
  assert.equal(rejected.status, "Rejected");
  const stored = await db.collection("bookings").findOne({ _id: booking._id });
  assert.equal("activeRequestKey" in (stored ?? {}), false);

  await assert.rejects(
    () => updateVendorBookingStatus(vendorId, booking._id.toHexString(), "accept", db),
    (error: unknown) => error instanceof AppError && error.code === "BOOKING_ALREADY_PROCESSED"
  );

  await assert.rejects(
    () =>
      updateVendorBookingStatus(
        "507f1f77bcf86cd799439099",
        booking._id.toHexString(),
        "accept",
        db
      ),
    (error: unknown) => error instanceof AppError && error.code === "BOOKING_NOT_FOUND"
  );
});

test("admin dashboard premium count uses effective, not stored, plans", async () => {
  const stats = await getAdminDashboardStats({
    countUsers: async () => 20,
    countCustomers: async () => 12,
    countVendors: async () => 8,
    countBlockedUsers: async () => 3,
    countServices: async () => 40,
    countServicesByApprovalStatus: async (status) =>
      ({ pending: 5, approved: 30, rejected: 5 })[status],
    countBookings: async () => 70,
    countBookingsByStatus: async (status) =>
      ({ Pending: 10, Accepted: 20, Rejected: 30, Cancelled: 10 })[status],
    countTransactions: async () => 9,
    countTransactionsByStatus: async (status) => (status === "completed" ? 6 : 0),
    sumSuccessfulTransactionAmounts: async () => [
      { currency: "usd", amount: 125.5 },
      { currency: "ngn", amount: 5000 },
    ],
    listPremiumVendorIds: async () => [
      { subscriptionPlan: "premium", subscriptionExpiresAt: new Date("2999-01-01") },
      { subscriptionPlan: "premium", subscriptionExpiresAt: new Date("2020-01-01") },
      { subscriptionPlan: "free" },
    ],
  });

  assert.deepEqual(stats, {
    totalUsers: 20,
    totalCustomers: 12,
    totalVendors: 8,
    totalBlockedUsers: 3,
    totalServices: 40,
    pendingServiceApprovals: 5,
    approvedServices: 30,
    rejectedServices: 5,
    totalBookings: 70,
    pendingBookings: 10,
    acceptedBookings: 20,
    rejectedBookings: 30,
    cancelledBookings: 10,
    totalTransactions: 9,
    successfulTransactions: 6,
    successfulTransactionAmounts: [
      { currency: "usd", amount: 125.5 },
      { currency: "ngn", amount: 5000 },
    ],
    premiumVendors: 1,
  });
});

test("successful transaction amounts are grouped by their stored currency", async () => {
  let pipeline: unknown;
  const db = {
    collection(name: string) {
      assert.equal(name, "transactions");
      return {
        aggregate(value: unknown) {
          pipeline = value;
          return {
            async toArray() {
              return [
                { _id: "USD", totalAmount: 125.5 },
                { _id: "ngn", totalAmount: 5000 },
              ];
            },
          };
        },
      };
    },
  } as unknown as Db;

  const totals = await sumSuccessfulTransactionAmounts(db);

  assert.deepEqual(pipeline, [
    { $match: { status: "completed" } },
    {
      $group: {
        _id: { $toLower: "$currency" },
        totalAmount: { $sum: "$amount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  assert.deepEqual(totals, [
    { currency: "usd", amount: 125.5 },
    { currency: "ngn", amount: 5000 },
  ]);
});

test("first Admin provisioning requires an existing unblocked account and preserves roles", async () => {
  const user = {
    _id: new ObjectId("507f1f77bcf86cd799439012"),
    email: "vendor@example.com",
    role: "vendor",
    roles: ["customer", "vendor"],
    isBlocked: false,
    emailVerified: true,
  };
  const db = {
    collection(name: string) {
      assert.equal(name, "user");
      return {
        async findOne(filter: Record<string, unknown>) {
          if ("$or" in filter) {
            return user.role === "admin" || user.roles.includes("admin")
              ? user
              : null;
          }
          const email = filter.email;
          return email instanceof RegExp && email.test(user.email) ? user : null;
        },
        async updateOne(
          filter: Record<string, unknown>,
          update: { $set: Record<string, unknown> }
        ) {
          if (
            filter._id !== user._id ||
            user.role === "admin" ||
            user.roles.includes("admin") ||
            user.isBlocked
          ) {
            return { matchedCount: 0 };
          }
          Object.assign(user, update.$set);
          return { matchedCount: 1 };
        },
      };
    },
  } as unknown as Db;

  const result = await provisionInitialAdmin(" VENDOR@example.com ", db);

  assert.deepEqual(result, {
    id: user._id.toString(),
    email: "vendor@example.com",
  });
  assert.equal(user.role, "admin");
  assert.deepEqual(user.roles, ["customer", "vendor", "admin"]);
  await assert.rejects(
    () => provisionInitialAdmin("vendor@example.com", db),
    (error: unknown) =>
      error instanceof AppError && error.code === "ADMIN_ALREADY_PROVISIONED"
  );
});

test("first Admin provisioning refuses missing, blocked, and unverified accounts", async () => {
  const user = {
    _id: new ObjectId("507f1f77bcf86cd799439012"),
    email: "vendor@example.com",
    role: "vendor",
    roles: ["vendor"],
    isBlocked: true,
    emailVerified: true,
  };
  const db = {
    collection() {
      return {
        async findOne(filter: Record<string, unknown>) {
          if ("$or" in filter) return null;
          const email = filter.email;
          return email instanceof RegExp && email.test(user.email) ? user : null;
        },
        async updateOne() {
          return { matchedCount: 0 };
        },
      };
    },
  } as unknown as Db;

  await assert.rejects(
    () => provisionInitialAdmin("missing@example.com", db),
    (error: unknown) =>
      error instanceof AppError && error.code === "ADMIN_ACCOUNT_NOT_FOUND"
  );
  await assert.rejects(
    () => provisionInitialAdmin("vendor@example.com", db),
    (error: unknown) =>
      error instanceof AppError && error.code === "ADMIN_ACCOUNT_BLOCKED"
  );
  user.isBlocked = false;
  user.emailVerified = false;
  await assert.rejects(
    () => provisionInitialAdmin("vendor@example.com", db),
    (error: unknown) =>
      error instanceof AppError && error.code === "ADMIN_EMAIL_UNVERIFIED"
  );
});

test("admin user management protects admins and self while allowing vendor blocks", async () => {
  const adminId = "507f1f77bcf86cd799439011";
  const vendorId = "507f1f77bcf86cd799439012";
  const otherAdminId = "507f1f77bcf86cd799439015";
  const users = [
    { _id: new ObjectId(adminId), role: "admin", name: "Admin", email: "admin@example.com", createdAt: new Date() },
    { _id: new ObjectId(otherAdminId), role: "admin", name: "Other", email: "other@example.com", createdAt: new Date() },
    {
      _id: new ObjectId(vendorId),
      role: "vendor",
      name: "Vendor",
      email: "vendor@example.com",
      createdAt: new Date(),
      subscriptionPlan: "free",
    },
  ];
  const db = createFakeDb({ user: users });

  await assert.rejects(
    () => setUserBlocked(adminId, adminId, true, db),
    (error: unknown) => error instanceof AppError && error.code === "CANNOT_BLOCK_SELF"
  );
  await assert.rejects(
    () => setUserBlocked(adminId, otherAdminId, true, db),
    (error: unknown) => error instanceof AppError && error.code === "ADMIN_ACCOUNT_PROTECTED"
  );

  const blocked = await setUserBlocked(adminId, vendorId, true, db);
  assert.equal(blocked.isBlocked, true);
});

test("editing an approved service requires fresh approval and rejection records a reason", async () => {
  const document = serviceDocument({ approvalStatus: "approved" });
  const db = createFakeDb({ services: [document] });

  const updated = await updateVendorServiceWithApproval(
    document.vendorId as string,
    document._id.toHexString(),
    { title: "Updated wedding photography" },
    db
  );

  assert.equal(updated?.approvalStatus, "pending");

  const reason = "Image set is incomplete and the description is unclear";
  const rejected = await setServiceApprovalStatus(
    document._id.toHexString(),
    "rejected",
    db,
    reason,
    "pending"
  );

  assert.equal(rejected?.approvalStatus, "rejected");
  assert.equal(rejected?.rejectionReason, reason);
});

test("a rejected service returns to pending when the vendor resubmits changes", async () => {
  const document = serviceDocument({
    approvalStatus: "rejected",
    rejectionReason: "Please add more portfolio images",
  });
  const db = createFakeDb({ services: [document] });

  const updated = await updateVendorServiceWithApproval(
    document.vendorId as string,
    document._id.toHexString(),
    { title: "Updated portfolio", images: ["https://images.example.com/new.jpg"] },
    db
  );

  assert.equal(updated?.approvalStatus, "pending");
  assert.equal(updated?.rejectionReason, undefined);
});

test("new dashboard routes reject authenticated users without the required role", async (t) => {
  const app = (
    await import("../src/app.js")
  ).createApp({
    api: {
      getSession: async () => ({
        session: { expiresAt: "2999-01-01T00:00:00.000Z" },
        user: {
          id: "507f1f77bcf86cd799439011",
          role: "vendor",
          isBlocked: false,
        },
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

  for (const path of [
    "/api/admin/dashboard",
    "/api/admin/users",
    "/api/admin/bookings",
    "/api/admin/transactions",
    "/api/admin/services/507f1f77bcf86cd799439012/active",
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 403, path);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "ADMIN_ACCESS_REQUIRED", path);
  }
});
