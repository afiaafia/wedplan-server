import type { RequestHandler } from "express";
import type { Auth } from "../lib/auth.js";
import { hasValidSessionExpiry } from "../lib/session-expiry.js";
import { AppError } from "../errors/app-error.js";

export interface AuthenticatedVendor {
  id: string;
  email: string;
  name: string;
}

interface SessionUserForVendorAuth {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  role?: unknown;
  isBlocked?: unknown;
}

interface SessionForVendorAuth {
  session?: { expiresAt?: unknown };
  user?: SessionUserForVendorAuth;
}

declare global {
  namespace Express {
    interface Locals {
      vendor: AuthenticatedVendor;
    }
  }
}

export function authorizeVendorSession(
  session: SessionForVendorAuth | null | undefined
): AuthenticatedVendor {
  if (!session?.user) {
    throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue");
  }

  if (!hasValidSessionExpiry(session.session?.expiresAt)) {
    throw new AppError(401, "UNAUTHORIZED", "Your session has expired");
  }

  if (session.user.role !== "vendor") {
    throw new AppError(
      403,
      "VENDOR_ACCESS_REQUIRED",
      "Only vendors can access this resource"
    );
  }

  if (session.user.isBlocked) {
    throw new AppError(
      403,
      "ACCOUNT_BLOCKED",
      "Your account has been blocked"
    );
  }

  const { id, email, name } = session.user;
  if (
    typeof id !== "string" ||
    !id ||
    typeof email !== "string" ||
    typeof name !== "string"
  ) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid vendor session");
  }

  return { id, email, name };
}

export function requireVendor(auth: Auth): RequestHandler {
  return (req, res, next) => {
    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(
          key,
          Array.isArray(value) ? value.join(", ") : value
        );
      }
    }

    void auth.api
      .getSession({ headers })
      .then((session) => {
        res.locals.vendor = authorizeVendorSession(session);
        next();
      })
      .catch(next);
  };
}
