import { ObjectId, type Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { hasUserRole, normalizeUserRoles } from "../validators/user.validator.js";
import type { UserRole } from "../types/user.js";

interface OnboardingUser {
  role?: unknown;
  roles?: UserRole[];
  isBlocked?: unknown;
}

export async function activateVendorAccess(
  userId: string,
  db: Db = getDatabase()
): Promise<UserRole[]> {
  if (!ObjectId.isValid(userId)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid account session");
  }

  const users = db.collection<OnboardingUser>("user");
  const objectId = new ObjectId(userId);
  const user = await users.findOne(
    { _id: objectId },
    { projection: { role: 1, roles: 1, isBlocked: 1 } }
  );

  if (!user) {
    throw new AppError(401, "UNAUTHORIZED", "Your account no longer exists");
  }
  if (user.isBlocked === true) {
    throw new AppError(403, "ACCOUNT_BLOCKED", "Your account has been blocked");
  }

  const roles = normalizeUserRoles(user.roles, user.role);
  if (roles.includes("admin")) {
    throw new AppError(
      403,
      "ADMIN_ROLE_PROTECTED",
      "Administrator accounts cannot use public vendor onboarding"
    );
  }
  if (roles.includes("vendor")) return roles;
  if (!hasUserRole(roles, "customer")) {
    throw new AppError(
      403,
      "CUSTOMER_ACCESS_REQUIRED",
      "Only customer accounts can activate vendor access"
    );
  }
  const result = await users.updateOne(
    {
      _id: objectId,
      isBlocked: { $ne: true },
      roles: { $all: ["customer"], $nin: ["admin"] },
    },
    {
      $addToSet: { roles: "vendor" },
      $set: { updatedAt: new Date() },
    }
  );

  if (result.matchedCount !== 1) {
    throw new AppError(
      409,
      "ROLE_ONBOARDING_CONFLICT",
      "Your account changed during onboarding. Refresh and try again."
    );
  }

  return normalizeUserRoles([...roles, "vendor"], user.role);
}
