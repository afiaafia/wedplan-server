import { ObjectId, type Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { COLLECTIONS } from "../config/collections.js";
import { resolveEffectivePlan } from "../services/subscription-plan.service.js";
import type { BookingStatus } from "../types/booking.js";
import type { ServiceApprovalStatus } from "../types/service.js";
import type { TransactionStatus } from "../types/transaction.js";
import {
  getPrimaryUserRole,
  normalizeUserRoles,
} from "../validators/user.validator.js";
import type {
  AdminDashboardData,
  AdminDashboardStats,
} from "../types/dashboard.js";

const USER_COLLECTION = "user";

interface UserPlanDocument {
  subscriptionPlan?: unknown;
  subscriptionExpiresAt?: unknown;
}

export interface AdminCountDependencies {
  countUsers: (db?: Db) => Promise<number>;
  countCustomers: (db?: Db) => Promise<number>;
  countVendors: (db?: Db) => Promise<number>;
  countBlockedUsers: (db?: Db) => Promise<number>;
  countServices: (db?: Db) => Promise<number>;
  countServicesByApprovalStatus: (
    status: ServiceApprovalStatus,
    db?: Db
  ) => Promise<number>;
  countBookings: (db?: Db) => Promise<number>;
  countBookingsByStatus: (status: BookingStatus, db?: Db) => Promise<number>;
  countTransactions: (db?: Db) => Promise<number>;
  countTransactionsByStatus: (
    status: TransactionStatus,
    db?: Db
  ) => Promise<number>;
  sumSuccessfulTransactionAmounts: (
    db?: Db
  ) => Promise<Array<{ currency: string; amount: number }>>;
  listPremiumVendorIds: (db?: Db) => Promise<UserPlanDocument[]>;
}

function connectedDb(db?: Db): Db {
  return db ?? getDatabase();
}

export async function sumSuccessfulTransactionAmounts(
  db?: Db
): Promise<Array<{ currency: string; amount: number }>> {
  const records = await connectedDb(db)
    .collection(COLLECTIONS.transactions)
    .aggregate<{ _id: unknown; totalAmount: unknown }>([
      { $match: { status: "completed" } },
      {
        $group: {
          _id: { $toLower: "$currency" },
          totalAmount: { $sum: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return records.map((record) => {
    if (
      typeof record._id !== "string" ||
      !record._id.trim() ||
      typeof record.totalAmount !== "number" ||
      !Number.isFinite(record.totalAmount)
    ) {
      throw new Error("Completed transaction totals contain invalid data");
    }

    return {
      currency: record._id.toLowerCase(),
      amount: record.totalAmount,
    };
  });
}

const defaultDependencies: AdminCountDependencies = {
  countUsers: (db) => connectedDb(db).collection(USER_COLLECTION).countDocuments({}),
  countCustomers: (db) =>
    connectedDb(db).collection(USER_COLLECTION).countDocuments({ roles: "customer" }),
  countVendors: (db) =>
    connectedDb(db).collection(USER_COLLECTION).countDocuments({ roles: "vendor" }),
  countBlockedUsers: (db) =>
    connectedDb(db).collection(USER_COLLECTION).countDocuments({ isBlocked: true }),
  countServices: (db) => connectedDb(db).collection(COLLECTIONS.services).countDocuments({}),
  countServicesByApprovalStatus: (status, db) =>
    connectedDb(db)
      .collection(COLLECTIONS.services)
      .countDocuments({ approvalStatus: status }),
  countBookings: (db) => connectedDb(db).collection(COLLECTIONS.bookings).countDocuments({}),
  countBookingsByStatus: (status, db) =>
    connectedDb(db).collection(COLLECTIONS.bookings).countDocuments({ status }),
  countTransactions: (db) => connectedDb(db).collection(COLLECTIONS.transactions).countDocuments({}),
  countTransactionsByStatus: (status, db) =>
    connectedDb(db).collection(COLLECTIONS.transactions).countDocuments({ status }),
  sumSuccessfulTransactionAmounts,
  listPremiumVendorIds: (db) =>
    connectedDb(db)
      .collection<UserPlanDocument>(USER_COLLECTION)
      .find(
        { roles: "vendor", subscriptionPlan: "premium" },
        { projection: { subscriptionPlan: 1, subscriptionExpiresAt: 1 } }
      )
      .toArray(),
};

export async function getAdminDashboardStats(
  dependencies: AdminCountDependencies = defaultDependencies,
  db?: Db
): Promise<AdminDashboardStats> {
  const [
    totalUsers,
    totalCustomers,
    totalVendors,
    totalBlockedUsers,
    totalServices,
    pendingServiceApprovals,
    approvedServices,
    rejectedServices,
    totalBookings,
    pendingBookings,
    acceptedBookings,
    rejectedBookings,
    cancelledBookings,
    totalTransactions,
    successfulTransactions,
    successfulTransactionAmounts,
    premiumVendors,
  ] = await Promise.all([
    dependencies.countUsers(db),
    dependencies.countCustomers(db),
    dependencies.countVendors(db),
    dependencies.countBlockedUsers(db),
    dependencies.countServices(db),
    dependencies.countServicesByApprovalStatus("pending", db),
    dependencies.countServicesByApprovalStatus("approved", db),
    dependencies.countServicesByApprovalStatus("rejected", db),
    dependencies.countBookings(db),
    dependencies.countBookingsByStatus("Pending", db),
    dependencies.countBookingsByStatus("Accepted", db),
    dependencies.countBookingsByStatus("Rejected", db),
    dependencies.countBookingsByStatus("Cancelled", db),
    dependencies.countTransactions(db),
    dependencies.countTransactionsByStatus("completed", db),
    dependencies.sumSuccessfulTransactionAmounts(db),
    dependencies
      .listPremiumVendorIds(db)
      .then((records) =>
        records.filter((record) => resolveEffectivePlan(record) === "premium").length
      ),
  ]);

  return {
    totalUsers,
    totalCustomers,
    totalVendors,
    totalBlockedUsers,
    totalServices,
    pendingServiceApprovals,
    approvedServices,
    rejectedServices,
    totalBookings,
    pendingBookings,
    acceptedBookings,
    rejectedBookings,
    cancelledBookings,
    totalTransactions,
    successfulTransactions,
    successfulTransactionAmounts,
    premiumVendors,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function getAdminDashboardData(
  db: Db = getDatabase(),
  dependencies: AdminCountDependencies = defaultDependencies
): Promise<AdminDashboardData> {
  const recentLimit = 5;

  const [stats, users, services, bookings, transactions] = await Promise.all([
    getAdminDashboardStats(dependencies, db),
    db
      .collection(USER_COLLECTION)
      .find(
        {},
        {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            roles: 1,
            createdAt: 1,
          },
        }
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(recentLimit)
      .toArray(),
    db
      .collection(COLLECTIONS.services)
      .find(
        {},
        {
          projection: {
            title: 1,
            category: 1,
            approvalStatus: 1,
            vendorId: 1,
            createdAt: 1,
            images: 1,
          },
        }
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(recentLimit)
      .toArray(),
    db
      .collection(COLLECTIONS.bookings)
      .find(
        {},
        { projection: { serviceId: 1, status: 1, createdAt: 1, eventDate: 1 } }
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(recentLimit)
      .toArray(),
    db
      .collection(COLLECTIONS.transactions)
      .find(
        {},
        {
          projection: {
            plan: 1,
            amount: 1,
            currency: 1,
            status: 1,
            createdAt: 1,
            vendorId: 1,
          },
        }
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(recentLimit)
      .toArray(),
  ]);

  const vendorIds = Array.from(
    new Set(
      [
        ...services.map((service) => service.vendorId),
        ...transactions.map((transaction) => transaction.vendorId),
      ]
        .filter((id): id is string => typeof id === "string" && ObjectId.isValid(id))
    )
  ).map((id) => new ObjectId(id));

  const vendorDocuments = vendorIds.length
    ? await db
        .collection(USER_COLLECTION)
        .find({ _id: { $in: vendorIds } }, { projection: { name: 1 } })
        .toArray()
    : [];
  const vendorNames = new Map(
    vendorDocuments.map((vendor) => [
      vendor._id.toString(),
      asString((vendor as { name?: unknown }).name) ?? "Vendor",
    ])
  );

  return {
    stats,
    recentUsers: users.map((user) => {
      const record = user as unknown as Record<string, unknown>;
      const image = asString(record.image);
      const roles = normalizeUserRoles(record.roles, record.role);
      const role = getPrimaryUserRole(roles, record.role);
      const createdAt = record.createdAt;
      return {
        id: user._id.toString(),
        name: asString(record.name) ?? "Unknown user",
        email: asString(record.email) ?? "",
        ...(image ? { image } : {}),
        role,
        roles,
        createdAt:
          createdAt instanceof Date
            ? createdAt.toISOString()
            : new Date(0).toISOString(),
      };
    }),
    recentServices: services.map((service) => {
      const record = service as unknown as Record<string, unknown>;
      const vendorName = vendorNames.get(asString(record.vendorId) ?? "");
      const images = record.images;
      const firstImage = Array.isArray(images) ? asString(images[0]) : undefined;
      const createdAt = record.createdAt;
      return {
        id: service._id.toString(),
        title: asString(record.title) ?? "Untitled service",
        category: asString(record.category) ?? "Other",
        approvalStatus: asString(record.approvalStatus) ?? "pending",
        createdAt:
          createdAt instanceof Date
            ? createdAt.toISOString()
            : new Date(0).toISOString(),
        ...(vendorName ? { vendorName } : {}),
        ...(firstImage ? { image: firstImage } : {}),
      };
    }),
    recentBookings: bookings.map((booking) => {
      const record = booking as unknown as Record<string, unknown>;
      const createdAt = record.createdAt;
      const eventDate = record.eventDate;
      return {
        id: booking._id.toString(),
        serviceId: asString(record.serviceId) ?? "",
        status: asString(record.status) ?? "Pending",
        createdAt:
          createdAt instanceof Date
            ? createdAt.toISOString()
            : new Date(0).toISOString(),
        eventDate:
          eventDate instanceof Date
            ? eventDate.toISOString()
            : new Date(0).toISOString(),
      };
    }),
    recentTransactions: transactions.map((transaction) => {
      const record = transaction as unknown as Record<string, unknown>;
      const vendorName = vendorNames.get(asString(record.vendorId) ?? "");
      const createdAt = record.createdAt;
      return {
        id: transaction._id.toString(),
        plan: asString(record.plan) ?? "premium",
        amount: typeof record.amount === "number" ? record.amount : 0,
        currency: asString(record.currency) ?? "usd",
        status: asString(record.status) ?? "pending",
        createdAt:
          createdAt instanceof Date
            ? createdAt.toISOString()
            : new Date(0).toISOString(),
        ...(vendorName ? { vendorName } : {}),
      };
    }),
  };
}
