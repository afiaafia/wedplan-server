import { ObjectId, type Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { COLLECTIONS } from "../config/collections.js";
import { resolveEffectivePlan } from "../services/subscription-plan.service.js";
import {
  normalizeUserRole,
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
  countServices: (db?: Db) => Promise<number>;
  countPendingServices: (db?: Db) => Promise<number>;
  countBookings: (db?: Db) => Promise<number>;
  countTransactions: (db?: Db) => Promise<number>;
  listPremiumVendorIds: (db?: Db) => Promise<UserPlanDocument[]>;
}

function connectedDb(db?: Db): Db {
  return db ?? getDatabase();
}

const defaultDependencies: AdminCountDependencies = {
  countUsers: (db) => connectedDb(db).collection(USER_COLLECTION).countDocuments({}),
  countCustomers: (db) =>
    connectedDb(db).collection(USER_COLLECTION).countDocuments({ roles: "customer" }),
  countVendors: (db) =>
    connectedDb(db).collection(USER_COLLECTION).countDocuments({ roles: "vendor" }),
  countServices: (db) => connectedDb(db).collection(COLLECTIONS.services).countDocuments({}),
  countPendingServices: (db) =>
    connectedDb(db).collection(COLLECTIONS.services).countDocuments({ approvalStatus: "pending" }),
  countBookings: (db) => connectedDb(db).collection(COLLECTIONS.bookings).countDocuments({}),
  countTransactions: (db) => connectedDb(db).collection(COLLECTIONS.transactions).countDocuments({}),
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
    totalServices,
    pendingServiceApprovals,
    totalBookings,
    totalTransactions,
    premiumVendors,
  ] = await Promise.all([
    dependencies.countUsers(db),
    dependencies.countCustomers(db),
    dependencies.countVendors(db),
    dependencies.countServices(db),
    dependencies.countPendingServices(db),
    dependencies.countBookings(db),
    dependencies.countTransactions(db),
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
    totalServices,
    pendingServiceApprovals,
    totalBookings,
    totalTransactions,
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
      const role = normalizeUserRole(record.role);
      const roles = normalizeUserRoles(record.roles, record.role);
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
