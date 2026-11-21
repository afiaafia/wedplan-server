import { ObjectId } from "mongodb";
import { getDatabase } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import type {
  SubscriptionPlanName,
  UserSubscriptionRecord,
} from "../types/user.js";

export const FREE_ACTIVE_SERVICE_LIMIT = 3;

const USER_COLLECTION = "user";

export function parseSubscriptionExpiry(value: unknown, now = Date.now()): number | null {
  let timestamp: number;

  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === "number") {
    timestamp = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    timestamp = Date.parse(value);
  } else {
    return null;
  }

  if (!Number.isFinite(timestamp) || timestamp <= now) {
    return null;
  }

  return timestamp;
}

export function resolveEffectivePlan(
  record: UserSubscriptionRecord,
  now: Date = new Date()
): SubscriptionPlanName {
  if (record.subscriptionPlan !== "premium") {
    return "free";
  }

  return parseSubscriptionExpiry(
    record.subscriptionExpiresAt,
    now.getTime()
  ) === null
    ? "free"
    : "premium";
}

export function getActiveServiceLimit(
  plan: SubscriptionPlanName
): number | null {
  return plan === "premium" ? null : FREE_ACTIVE_SERVICE_LIMIT;
}

export function canActivateWithPlan(
  plan: SubscriptionPlanName,
  activeServiceCount: number
): boolean {
  const limit = getActiveServiceLimit(plan);
  return limit === null || activeServiceCount < limit;
}

export async function getVendorEffectivePlan(
  vendorId: string
): Promise<SubscriptionPlanName> {
  if (!ObjectId.isValid(vendorId)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid vendor account");
  }

  const vendor = await getDatabase()
    .collection<UserSubscriptionRecord>(USER_COLLECTION)
    .findOne(
      {
        _id: new ObjectId(vendorId),
        role: "vendor",
        isBlocked: { $ne: true },
      },
      {
        projection: {
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
        },
      }
    );

  if (!vendor) {
    throw new AppError(401, "UNAUTHORIZED", "Vendor account no longer exists");
  }

  return resolveEffectivePlan(vendor);
}
