import { ObjectId, type Db } from "mongodb";
import { AppError } from "../errors/app-error.js";
import { normalizeUserRoles } from "../validators/user.validator.js";
import type { UserRole } from "../types/user.js";

interface ProvisionableUser {
  _id: ObjectId;
  email?: unknown;
  role?: unknown;
  roles?: unknown;
  isBlocked?: unknown;
  emailVerified?: unknown;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function provisionInitialAdmin(
  emailInput: string,
  db: Db
): Promise<{ id: string; email: string }> {
  const email = emailInput.trim().toLowerCase();
  if (!email) {
    throw new AppError(400, "INVALID_ADMIN_EMAIL", "An Admin email is required");
  }

  const users = db.collection<ProvisionableUser>("user");
  const existingAdmin = await users.findOne(
    { $or: [{ role: "admin" }, { roles: "admin" }] },
    { projection: { _id: 1 } }
  );
  if (existingAdmin) {
    throw new AppError(
      409,
      "ADMIN_ALREADY_PROVISIONED",
      "An Admin account already exists"
    );
  }

  const target = await users.findOne(
    { email: new RegExp(`^${escapeRegex(email)}$`, "i") },
    {
      projection: {
        email: 1,
        role: 1,
        roles: 1,
        isBlocked: 1,
        emailVerified: 1,
      },
    }
  );
  if (!target) {
    throw new AppError(
      404,
      "ADMIN_ACCOUNT_NOT_FOUND",
      "Create the account through the existing sign-in flow before provisioning it"
    );
  }
  if (target.isBlocked === true) {
    throw new AppError(
      409,
      "ADMIN_ACCOUNT_BLOCKED",
      "A blocked account cannot be provisioned as the first Admin"
    );
  }
  if (target.emailVerified !== true) {
    throw new AppError(
      409,
      "ADMIN_EMAIL_UNVERIFIED",
      "The account email must be verified before Admin provisioning"
    );
  }
  if (!ObjectId.isValid(target._id)) {
    throw new AppError(
      409,
      "ADMIN_ACCOUNT_INVALID",
      "The selected account has an invalid database identifier"
    );
  }

  const roles = new Set<UserRole>(normalizeUserRoles(target.roles, target.role));
  roles.add("admin");
  const updated = await users.updateOne(
    {
      _id: target._id,
      role: { $ne: "admin" },
      roles: { $nin: ["admin"] },
      isBlocked: { $ne: true },
    },
    {
      $set: {
        role: "admin",
        roles: [...roles],
        updatedAt: new Date(),
      },
    }
  );

  if (updated.matchedCount !== 1) {
    throw new AppError(
      409,
      "ADMIN_PROVISIONING_CONFLICT",
      "The account changed during Admin provisioning; no privileges were changed"
    );
  }

  return {
    id: target._id.toString(),
    email: typeof target.email === "string" ? target.email : email,
  };
}
