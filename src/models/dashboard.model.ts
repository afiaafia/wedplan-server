import { getDatabase } from "../config/database.js";
import { ObjectId, type Db } from "mongodb";
import {
  countVendorBookings,
  countVendorBookingsByStatus,
} from "./booking.model.js";
import {
  countActiveVendorServices,
  countVendorServices,
  countVendorServicesPendingApproval,
} from "./service.model.js";
import {
  getActiveServiceLimit,
  resolveEffectivePlan,
} from "../services/subscription-plan.service.js";
import type { VendorDashboardSummary } from "../types/dashboard.js";
import { AppError } from "../errors/app-error.js";

export interface VendorDashboardStats {
  totalServices: number;
  activeServices: number;
  pendingApproval: number;
  totalBookings: number;
}

export interface DashboardCountDependencies {
  countTotal: (vendorId: string) => Promise<number>;
  countActive: (vendorId: string) => Promise<number>;
  countPending: (vendorId: string) => Promise<number>;
  countBookings: (vendorId: string) => Promise<number>;
}

const defaultDependencies: DashboardCountDependencies = {
  countTotal: countVendorServices,
  countActive: countActiveVendorServices,
  countPending: countVendorServicesPendingApproval,
  countBookings: countVendorBookings,
};

export async function getVendorDashboardStats(
  vendorId: string,
  dependencies: DashboardCountDependencies = defaultDependencies
): Promise<VendorDashboardStats> {
  const [totalServices, activeServices, pendingApproval, totalBookings] =
    await Promise.all([
      dependencies.countTotal(vendorId),
      dependencies.countActive(vendorId),
      dependencies.countPending(vendorId),
      dependencies.countBookings(vendorId),
    ]);

  return {
    totalServices,
    activeServices,
    pendingApproval,
    totalBookings,
  };
}

export interface VendorSummaryDependencies {
  countTotal: (vendorId: string) => Promise<number>;
  countActive: (vendorId: string) => Promise<number>;
  countPending: (vendorId: string) => Promise<number>;
  countBookings: (vendorId: string) => Promise<number>;
  countPendingBookings: (
    vendorId: string,
    status: "Pending"
  ) => Promise<number>;
  countAcceptedBookings: (
    vendorId: string,
    status: "Accepted"
  ) => Promise<number>;
  resolvePlan: (vendorId: string, db?: Db) => Promise<"free" | "premium">;
}

async function resolvePlanFromDatabase(vendorId: string, db?: Db) {
  if (!ObjectId.isValid(vendorId)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid vendor account");
  }

  const activeDb = db ?? getDatabase();
  const vendor = await activeDb
    .collection<{
      subscriptionPlan?: unknown;
      subscriptionExpiresAt?: unknown;
    }>("user")
    .findOne(
      { _id: new ObjectId(vendorId), roles: "vendor", isBlocked: { $ne: true } },
      { projection: { subscriptionPlan: 1, subscriptionExpiresAt: 1 } }
    );

  if (!vendor) {
    throw new AppError(401, "UNAUTHORIZED", "Vendor account no longer exists");
  }

  return resolveEffectivePlan(vendor);
}

const defaultSummaryDependencies: VendorSummaryDependencies = {
  countTotal: countVendorServices,
  countActive: countActiveVendorServices,
  countPending: countVendorServicesPendingApproval,
  countBookings: countVendorBookings,
  countPendingBookings: (vendorId) =>
    countVendorBookingsByStatus(vendorId, "Pending"),
  countAcceptedBookings: (vendorId) =>
    countVendorBookingsByStatus(vendorId, "Accepted"),
  resolvePlan: resolvePlanFromDatabase,
};

export async function getVendorDashboardSummary(
  vendorId: string,
  dependencies: VendorSummaryDependencies = defaultSummaryDependencies,
  db?: Db
): Promise<VendorDashboardSummary> {
  const [
    totalServices,
    activeServices,
    pendingApproval,
    totalBookings,
    pendingBookingRequests,
    acceptedBookings,
    plan,
  ] = await Promise.all([
    dependencies.countTotal(vendorId),
    dependencies.countActive(vendorId),
    dependencies.countPending(vendorId),
    dependencies.countBookings(vendorId),
    dependencies.countPendingBookings(vendorId, "Pending"),
    dependencies.countAcceptedBookings(vendorId, "Accepted"),
    dependencies.resolvePlan(vendorId, db),
  ]);

  return {
    totalServices,
    activeServices,
    pendingApproval,
    totalBookings,
    pendingBookingRequests,
    acceptedBookings,
    currentSubscriptionPlan: plan,
    activeServiceLimit: getActiveServiceLimit(plan),
  };
}
