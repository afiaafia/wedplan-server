import { z } from "zod";
import {
  DEFAULT_USER_ROLE,
  REGISTRATION_ROLES,
  USER_ROLES,
  type RegistrationRole,
  type UserRole,
} from "../types/user.js";

export const registrationRoleSchema = z.enum(REGISTRATION_ROLES);

export const userRoleSchema = z.enum(USER_ROLES);

export function resolveRegistrationRole(value: unknown): RegistrationRole {
  const result = registrationRoleSchema.safeParse(value);
  return result.success ? result.data : DEFAULT_USER_ROLE;
}

export function normalizeUserRole(value: unknown): UserRole {
  const result = userRoleSchema.safeParse(value);
  return result.success ? result.data : DEFAULT_USER_ROLE;
}
