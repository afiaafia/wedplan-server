import type { RequestHandler } from "express";
import type { Auth } from "../lib/auth.js";
import { AppError } from "../errors/app-error.js";
import {
  authorizeSession,
  getSessionHeaders,
  type SessionSnapshot,
} from "./require-auth.js";

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string;
}

type SessionForAdminAuth = SessionSnapshot;

declare global {
  namespace Express {
    interface Locals {
      admin: AuthenticatedAdmin;
    }
  }
}

export function authorizeAdminSession(
  session: SessionForAdminAuth | null | undefined
): AuthenticatedAdmin {
  const user = authorizeSession(session, {
    allowedRoles: ["admin"],
    roleErrorCode: "ADMIN_ACCESS_REQUIRED",
    roleErrorMessage: "Only administrators can access this resource",
    invalidSessionMessage: "Invalid admin session",
  });

  if (!user.roles.includes("admin")) {
    throw new AppError(
      403,
      "ADMIN_ACCESS_REQUIRED",
      "Only administrators can access this resource"
    );
  }

  return { id: user.id, email: user.email, name: user.name };
}

export function requireAdmin(auth: Auth): RequestHandler {
  return (req, res, next) => {
    void auth.api
      .getSession({ headers: getSessionHeaders(req) })
      .then((session) => {
        res.locals.admin = authorizeAdminSession(
          session as SessionSnapshot | null
        );
        next();
      })
      .catch(next);
  };
}
