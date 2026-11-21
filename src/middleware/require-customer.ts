import type { RequestHandler } from "express";
import type { Auth } from "../lib/auth.js";
import { AppError } from "../errors/app-error.js";
import {
  authorizeSession,
  getSessionHeaders,
  type SessionSnapshot,
} from "./require-auth.js";

export interface AuthenticatedCustomer {
  id: string;
  email: string;
  name: string;
}

type SessionForCustomerAuth = SessionSnapshot;

declare global {
  namespace Express {
    interface Locals {
      customer: AuthenticatedCustomer;
    }
  }
}

export function authorizeCustomerSession(
  session: SessionForCustomerAuth | null | undefined
): AuthenticatedCustomer {
  const user = authorizeSession(session, {
    allowedRoles: ["customer"],
    roleErrorCode: "CUSTOMER_ACCESS_REQUIRED",
    roleErrorMessage: "Only customers can submit booking requests",
    invalidSessionMessage: "Invalid customer session",
  });

  if (user.role !== "customer") {
    throw new AppError(
      403,
      "CUSTOMER_ACCESS_REQUIRED",
      "Only customers can submit booking requests"
    );
  }

  return { id: user.id, email: user.email, name: user.name };
}

export function requireCustomer(auth: Auth): RequestHandler {
  return (req, res, next) => {
    void auth.api
      .getSession({ headers: getSessionHeaders(req) })
      .then((session) => {
        res.locals.customer = authorizeCustomerSession(
          session as SessionSnapshot | null
        );
        next();
      })
      .catch(next);
  };
}
