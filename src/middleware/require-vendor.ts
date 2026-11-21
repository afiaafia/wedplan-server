import type { RequestHandler } from "express";
import type { Auth } from "../lib/auth.js";
import { AppError } from "../errors/app-error.js";

export interface AuthenticatedVendor {
  id: string;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Locals {
      vendor: AuthenticatedVendor;
    }
  }
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
        if (!session) {
          throw new AppError(
            401,
            "UNAUTHORIZED",
            "Please sign in to continue"
          );
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

        res.locals.vendor = {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        };

        next();
      })
      .catch(next);
  };
}
