import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { ObjectId } from "mongodb";
import { getDatabase } from "../config/database.js";
import {
  getPrimaryUserRole,
  normalizeUserRoles,
} from "../validators/user.validator.js";
import type { UserRole } from "../types/user.js";

export const WEDPLAN_JWT_AUDIENCE = "wedplan-api";
export const WEDPLAN_JWT_TTL_SECONDS = 15 * 60;

function getJwtSecret(): Uint8Array {
  const secret =
    process.env.WEDPLAN_JWT_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "WEDPLAN_JWT_SECRET or BETTER_AUTH_SECRET must contain at least 32 characters"
    );
  }
  return new TextEncoder().encode(secret);
}

export function getJwtIssuer(): string {
  const baseUrl =
    process.env.WEDPLAN_JWT_ISSUER?.trim() ||
    process.env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) {
    throw new Error("WEDPLAN_JWT_ISSUER or BETTER_AUTH_URL is required");
  }
  return new URL(baseUrl).origin;
}

export interface WedPlanJwtClaims {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  roles: UserRole[];
  isBlocked: boolean;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export async function issueWedPlanJwt(user: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  roles: UserRole[];
  isBlocked: boolean;
}): Promise<string> {
  if (user.isBlocked) {
    throw new Error("Blocked users cannot receive an API token");
  }

  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    roles: user.roles,
    isBlocked: false,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(getJwtIssuer())
    .setAudience(WEDPLAN_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${WEDPLAN_JWT_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifyWedPlanJwt(token: string): Promise<WedPlanJwtClaims> {
  const verified = await jwtVerify(token, getJwtSecret(), {
    algorithms: ["HS256"],
    issuer: getJwtIssuer(),
    audience: WEDPLAN_JWT_AUDIENCE,
  });
  return parseWedPlanJwtPayload(verified.payload);
}

function parseWedPlanJwtPayload(payload: JWTPayload): WedPlanJwtClaims {
  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number" ||
    payload.iss !== getJwtIssuer() ||
    !payload.aud ||
    (Array.isArray(payload.aud)
      ? !payload.aud.includes(WEDPLAN_JWT_AUDIENCE)
      : payload.aud !== WEDPLAN_JWT_AUDIENCE)
  ) {
    throw new Error("Invalid WedPlan JWT claims");
  }

  const roles = normalizeUserRoles(payload.roles, payload.role);
  const role = getPrimaryUserRole(roles, payload.role);
  if (roles.length === 0) {
    throw new Error("Invalid WedPlan JWT role claims");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    role,
    roles,
    isBlocked: payload.isBlocked === true,
    iss: payload.iss,
    aud: WEDPLAN_JWT_AUDIENCE,
    exp: payload.exp,
    iat: payload.iat,
  };
}

export async function revalidateJwtUser(claims: WedPlanJwtClaims): Promise<{
  id: string;
  email: string;
  name: string;
  role: UserRole;
  roles: UserRole[];
  isBlocked: boolean;
}> {
  if (!ObjectId.isValid(claims.sub)) {
    throw new Error("Invalid JWT subject");
  }

  const user = await getDatabase().collection("user").findOne<{
    email?: unknown;
    name?: unknown;
    role?: unknown;
    roles?: unknown;
    isBlocked?: unknown;
  }>({ _id: new ObjectId(claims.sub) });

  if (!user) {
    throw new Error("JWT subject no longer exists");
  }
  if (user.isBlocked === true) {
    return {
      id: claims.sub,
      email: typeof user.email === "string" ? user.email : claims.email,
      name: typeof user.name === "string" ? user.name : claims.name,
      role: "customer",
      roles: ["customer"],
      isBlocked: true,
    };
  }

  const roles = normalizeUserRoles(user.roles, user.role);
  if (roles.length === 0) {
    throw new Error("JWT subject has no valid role");
  }
  return {
    id: claims.sub,
    email: typeof user.email === "string" ? user.email : claims.email,
    name: typeof user.name === "string" ? user.name : claims.name,
    role: getPrimaryUserRole(roles, user.role),
    roles,
    isBlocked: false,
  };
}
