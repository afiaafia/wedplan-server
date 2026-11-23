import { ObjectId, type Db, type UpdateFilter } from "mongodb";
import { getDatabase } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { resolveEffectivePlan } from "../services/subscription-plan.service.js";
import type { AdminUsersQuery } from "../validators/dashboard.validator.js";
import {
  hasUserRole,
  getPrimaryUserRole,
  normalizeUserRoles,
} from "../validators/user.validator.js";
import { buildPaginationMeta, type PaginationMeta } from "../types/dashboard.js";
import type { UserRole } from "../types/user.js";

const USER_COLLECTION = "user";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  image?: string;
  businessName?: string;
  role: "customer" | "vendor" | "admin";
  roles: UserRole[];
  isBlocked: boolean;
  subscriptionPlan: "free" | "premium";
  createdAt: string;
}

interface UserDocument {
  name?: unknown;
  email?: unknown;
  image?: unknown;
  businessName?: unknown;
  role?: unknown;
  roles?: unknown;
  isBlocked?: unknown;
  subscriptionPlan?: unknown;
  subscriptionExpiresAt?: unknown;
  createdAt?: Date;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toAdminUser(document: UserDocument & { _id: unknown }): AdminUser {
  const roles = normalizeUserRoles(document.roles, document.role);
  const role = getPrimaryUserRole(roles, document.role);
  const plan = resolveEffectivePlan({
    subscriptionPlan: document.subscriptionPlan,
    subscriptionExpiresAt: document.subscriptionExpiresAt,
  });

  return {
    id: String(document._id),
    name: optionalText(document.name) ?? "Unknown user",
    email: optionalText(document.email) ?? "",
    ...(optionalText(document.image) ? { image: optionalText(document.image) as string } : {}),
    ...(optionalText(document.businessName)
      ? { businessName: optionalText(document.businessName) as string }
      : {}),
    role,
    roles,
    isBlocked: document.isBlocked === true,
    subscriptionPlan: plan,
    createdAt: document.createdAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

function buildUserFilter(query: AdminUsersQuery) {
  const filter: Record<string, unknown> = {};

  if (query.role) filter.roles = query.role;
  if (query.blocked === "true") filter.isBlocked = true;
  if (query.blocked === "false") filter.isBlocked = { $ne: true };

  const keyword = query.q?.trim();
  if (keyword) {
    const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: { $regex: pattern } }, { email: { $regex: pattern } }];
  }

  return filter;
}

export async function findAdminUsers(
  query: AdminUsersQuery,
  db: Db = getDatabase()
): Promise<{ users: AdminUser[]; meta: PaginationMeta }> {
  const collection = db.collection<UserDocument>(USER_COLLECTION);
  const filter = buildUserFilter(query);

  const [documents, total] = await Promise.all([
    collection
      .find(filter, {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          businessName: 1,
          role: 1,
          roles: 1,
          isBlocked: 1,
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return {
    users: documents.map(toAdminUser),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function findAdminUserById(
  id: string,
  db: Db = getDatabase()
): Promise<AdminUser | null> {
  if (!ObjectId.isValid(id)) return null;

  const document = await db
    .collection<UserDocument>(USER_COLLECTION)
    .findOne({ _id: new ObjectId(id) }, {
      projection: {
        name: 1,
        email: 1,
        image: 1,
        businessName: 1,
        role: 1,
        roles: 1,
        isBlocked: 1,
        subscriptionPlan: 1,
        subscriptionExpiresAt: 1,
        createdAt: 1,
      },
    });

  return document ? toAdminUser(document) : null;
}

export async function setUserBlocked(
  adminId: string,
  targetId: string,
  isBlocked: boolean,
  db: Db = getDatabase()
): Promise<AdminUser> {
  if (!ObjectId.isValid(targetId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid user id");
  }

  if (targetId === adminId) {
    throw new AppError(
      400,
      "CANNOT_BLOCK_SELF",
      "You cannot change the blocked status of your own admin account"
    );
  }

  const targetObjectId = new ObjectId(targetId);
  const target = await db
    .collection<UserDocument>(USER_COLLECTION)
    .findOne(
      { _id: targetObjectId },
      { projection: { role: 1, roles: 1, isBlocked: 1 } }
    );

  if (!target) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  if (hasUserRole(target.roles, "admin", target.role)) {
    throw new AppError(
      403,
      "ADMIN_ACCOUNT_PROTECTED",
      "Admin accounts cannot be blocked through user management"
    );
  }

  const update: UpdateFilter<UserDocument> = isBlocked
    ? { $set: { isBlocked: true } }
    : { $unset: { isBlocked: "" } };

  await db
    .collection<UserDocument>(USER_COLLECTION)
    .updateOne({ _id: targetObjectId }, update);

  const updated = await findAdminUserById(targetId, db);
  if (!updated) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  return updated;
}
