import type { Request, RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../lib/auth.js";
import { hasValidSessionExpiry } from "../lib/session-expiry.js";
import { AppError } from "../errors/app-error.js";
import { normalizeUserRole } from "../validators/user.validator.js";
import type { UserRole } from "../types/user.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isBlocked: boolean;
}

export interface SessionSnapshot {
  session?: { expiresAt?: unknown };
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
    role?: unknown;
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

  const role = normalizeUserRole(session.user.role);

  if (options.allowedRoles && !options.allowedRoles.includes(role)) {
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

  return { id, email, name, role, isBlocked: false };
}

export function getSessionHeaders(request: Request): Headers {
  return fromNodeHeaders(request.headers);
}

export function requireSession(auth: Auth): RequestHandler {
  return (req, res, next) => {
    void auth.api
      .getSession({ headers: getSessionHeaders(req) })
      .then((session) => {
        res.locals.user = authorizeSession(session as SessionSnapshot | null);
        next();
      })
      .catch(next);
  };
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
