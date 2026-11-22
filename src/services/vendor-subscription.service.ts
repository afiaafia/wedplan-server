import { ObjectId, type Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { COLLECTIONS } from "../config/collections.js";
import { AppError } from "../errors/app-error.js";
import { countActiveVendorServices } from "../models/service.model.js";
import {
  getActiveServiceLimit,
  resolveEffectivePlan,
} from "./subscription-plan.service.js";
import { PREMIUM_BILLING_INTERVAL } from "./premium-plan.service.js";
import type { SubscriptionPlanName } from "../types/user.js";

interface VendorSubscriptionRecord {
  subscriptionPlan?: unknown;
  subscriptionExpiresAt?: unknown;
  stripeSubscriptionStartedAt?: unknown;
}

interface TransactionRecord {
  _id: ObjectId;
  plan?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  createdAt: Date;
  stripeSessionId?: string;
  subscriptionPeriodStart?: Date;
}

export type VendorSubscriptionStatus =
  | "active"
  | "expired"
  | "pending"
  | "failed"
  | "cancelled"
  | "none";

export interface VendorTransactionSummary {
  id: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  stripeSessionId?: string;
}

export interface VendorSubscriptionSummary {
  plan: SubscriptionPlanName;
  storedPlan: "free" | "premium" | "unknown";
  status: VendorSubscriptionStatus;
  startedAt: string | null;
  expiresAt: string | null;
  activeServices: number;
  activeServiceLimit: number | null;
  checkoutAvailable: boolean;
  price: { amount: number; currency: string; interval: string } | null;
  recentTransactions: VendorTransactionSummary[];
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function toHistory(transaction: TransactionRecord): VendorTransactionSummary {
  const history: VendorTransactionSummary = {
    id: transaction._id.toString(),
    status: typeof transaction.status === "string" ? transaction.status : "pending",
    amount: typeof transaction.amount === "number" ? transaction.amount : 0,
    currency:
      typeof transaction.currency === "string" ? transaction.currency : "usd",
    createdAt:
      transaction.createdAt instanceof Date
        ? transaction.createdAt.toISOString()
        : new Date().toISOString(),
  };

  if (transaction.stripeSessionId) {
    history.stripeSessionId = transaction.stripeSessionId;
  }

  return history;
}

export async function getVendorSubscriptionSummary(
  vendorId: string,
  db: Db = getDatabase()
): Promise<VendorSubscriptionSummary> {
  if (!ObjectId.isValid(vendorId)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid vendor account");
  }

  const vendor = await db
    .collection<VendorSubscriptionRecord>("user")
    .findOne(
      { _id: new ObjectId(vendorId), roles: "vendor", isBlocked: { $ne: true } },
      {
        projection: {
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
          stripeSubscriptionStartedAt: 1,
        },
      }
    );

  if (!vendor) {
    throw new AppError(401, "UNAUTHORIZED", "Vendor account no longer exists");
  }

  const transactions = (await db
    .collection<TransactionRecord>(COLLECTIONS.transactions)
    .find({ vendorId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(5)
    .toArray()) as TransactionRecord[];

  const latest = transactions[0];
  const plan = resolveEffectivePlan(vendor);
  const storedPlan =
    vendor.subscriptionPlan === "premium" || vendor.subscriptionPlan === "free"
      ? vendor.subscriptionPlan
      : "unknown";

  let status: VendorSubscriptionStatus;
  if (plan === "premium") {
    status = "active";
  } else if (storedPlan === "premium") {
    status = "expired";
  } else if (
    latest?.status === "pending" ||
    latest?.status === "failed" ||
    latest?.status === "cancelled"
  ) {
    status = latest.status;
  } else {
    status = "none";
  }

  const price =
    latest && typeof latest.amount === "number" && typeof latest.currency === "string"
      ? {
          amount: latest.amount,
          currency: latest.currency,
          interval: PREMIUM_BILLING_INTERVAL,
        }
      : null;

  const startedAt =
    toIsoString(vendor.stripeSubscriptionStartedAt) ??
    toIsoString(latest?.subscriptionPeriodStart);

  return {
    plan,
    storedPlan,
    status,
    startedAt,
    expiresAt: toIsoString(vendor.subscriptionExpiresAt),
    activeServices: await countActiveVendorServices(vendorId, undefined, db),
    activeServiceLimit: getActiveServiceLimit(plan),
    checkoutAvailable: Boolean(
      process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID
    ),
    price,
    recentTransactions: transactions.map(toHistory),
  };
}
