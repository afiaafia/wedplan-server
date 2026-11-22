import type { RequestHandler } from "express";
import type { Auth } from "../lib/auth.js";
import { AppError } from "../errors/app-error.js";
import {
  authorizeSession,
  getSessionHeaders,
  type SessionSnapshot,
  type AuthenticatedUser,
  authenticateRequest,
} from "./require-auth.js";

export interface AuthenticatedVendor {
  id: string;
  email: string;
  name: string;
}

type SessionForVendorAuth = SessionSnapshot;

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
  const user = authorizeSession(session, {
    allowedRoles: ["vendor"],
    roleErrorCode: "VENDOR_ACCESS_REQUIRED",
    roleErrorMessage: "Only vendors can access this resource",
    invalidSessionMessage: "Invalid vendor session",
  });

  if (!user.roles.includes("vendor")) {
    throw new AppError(
      403,
      "VENDOR_ACCESS_REQUIRED",
      "Only vendors can access this resource"
    );
  }

  return { id: user.id, email: user.email, name: user.name };
}

export function requireVendor(auth: Auth): RequestHandler {
  return (req, res, next) => {
    if (typeof req.headers.authorization === "string") {
    authenticateRequest(auth, req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      const existing = res.locals.user as AuthenticatedUser;
      if (existing.isBlocked) {
        next(new AppError(403, "ACCOUNT_BLOCKED", "Your account has been blocked"));
        return;
      }
      if (!existing.roles.includes("vendor")) {
        next(
          new AppError(
            403,
            "VENDOR_ACCESS_REQUIRED",
            "Only vendors can access this resource"
          )
        );
        return;
      }
      res.locals.vendor = {
        id: existing.id,
        email: existing.email,
        name: existing.name,
      };
      next();
    });
      return;
    }
    void auth.api
      .getSession({ headers: getSessionHeaders(req) })
      .then((session) => {
        res.locals.vendor = authorizeVendorSession(
          session as SessionSnapshot | null
        );
        next();
      })
      .catch(next);
  };
}
