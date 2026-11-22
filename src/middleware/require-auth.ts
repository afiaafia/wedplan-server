import type { NextFunction, Request, RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../lib/auth.js";
import { hasValidSessionExpiry } from "../lib/session-expiry.js";
import { AppError } from "../errors/app-error.js";
import {
  normalizeUserRole,
  normalizeUserRoles,
} from "../validators/user.validator.js";
import type { UserRole } from "../types/user.js";
import { revalidateJwtUser, verifyWedPlanJwt } from "../lib/jwt.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  roles: UserRole[];
  isBlocked: boolean;
}

export interface SessionSnapshot {
  session?: { expiresAt?: unknown };
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
    role?: unknown;
    roles?: unknown;
    isBlocked?: unknown;
  };
}

declare global {
  namespace Express {
    interface Locals {
      user: AuthenticatedUser;
    }
  }
}

export interface AuthorizationOptions {
  allowedRoles?: readonly UserRole[];
  roleErrorCode?: string;
  roleErrorMessage?: string;
  invalidSessionMessage?: string;
}

export function authorizeSession(
  session: SessionSnapshot | null | undefined,
  options: AuthorizationOptions = {}
): AuthenticatedUser {
  if (!session?.user) {
    throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue");
  }

  if (!hasValidSessionExpiry(session.session?.expiresAt)) {
    throw new AppError(401, "UNAUTHORIZED", "Your session has expired");
  }

  if (session.user.isBlocked === true) {
    throw new AppError(
      403,
      "ACCOUNT_BLOCKED",
      "Your account has been blocked"
    );
  }

  const roles = normalizeUserRoles(session.user.roles, session.user.role);
  const legacyRole = normalizeUserRole(session.user.role);
  const role = roles.includes(legacyRole) ? legacyRole : roles[0] ?? legacyRole;

  if (
    options.allowedRoles &&
    !options.allowedRoles.some((allowedRole) => roles.includes(allowedRole))
  ) {
    throw new AppError(
      403,
      options.roleErrorCode ?? "FORBIDDEN",
      options.roleErrorMessage ?? "You cannot access this resource"
    );
  }

  const { id, email, name } = session.user;
  if (
    typeof id !== "string" ||
    id.trim() === "" ||
    typeof email !== "string" ||
    email.trim() === "" ||
    typeof name !== "string"
  ) {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      options.invalidSessionMessage ?? "Invalid session"
    );
  }

  return { id, email, name, role, roles, isBlocked: false };
}

export function getSessionHeaders(request: Request): Headers {
  return fromNodeHeaders(request.headers);
}

export function requireSession(auth: Auth): RequestHandler {
  return (req, res, next) => {
    authenticateRequest(auth, req, res, next);
  };
}

export function authenticateRequest(
  auth: Auth,
  req: Request,
  res: Response,
  next: NextFunction
): void {
    const authorization = req.headers.authorization;
    if (typeof authorization === "string") {
      if (!authorization.startsWith("Bearer ")) {
        next(new AppError(401, "UNAUTHORIZED", "Invalid authorization scheme"));
        return;
      }
      const token = authorization.slice("Bearer ".length).trim();
      if (!token) {
        next(new AppError(401, "UNAUTHORIZED", "Invalid bearer token"));
        return;
      }
      void verifyWedPlanJwt(token)
        .then(revalidateJwtUser)
        .then((user) => {
          if (user.isBlocked) {
            throw new AppError(
              403,
              "ACCOUNT_BLOCKED",
              "Your account has been blocked"
            );
          }
          res.locals.user = user;
          next();
        })
        .catch(() => {
          next(new AppError(401, "UNAUTHORIZED", "Invalid or expired bearer token"));
        });
      return;
    }

    void auth.api
      .getSession({ headers: getSessionHeaders(req) })
      .then((session) => {
        res.locals.user = authorizeSession(session as SessionSnapshot | null);
        next();
      })
      .catch(next);
}

export function withAuthorizedSession(
  auth: Auth,
  authorize: (session: SessionSnapshot | null | undefined) => unknown,
  assign: (res: Response, value: unknown) => void
): RequestHandler {
  return (req, res, next) => {
    void auth.api
      .getSession({ headers: getSessionHeaders(req) })
      .then((session) => {
        assign(res, authorize(session as SessionSnapshot | null));
        next();
      })
      .catch(next);
  };
}
