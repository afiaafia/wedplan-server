import test from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../src/errors/app-error.js";
import type { Auth } from "../src/lib/auth.js";
import { hasValidSessionExpiry } from "../src/lib/session-expiry.js";
import {
  authorizeVendorSession,
  requireVendor,
} from "../src/middleware/require-vendor.js";

const vendorSession = {
  session: { expiresAt: "2999-01-01T00:00:00.000Z" },
  user: {
    id: "507f1f77bcf86cd799439011",
    email: "vendor@example.com",
    name: "Vendor Owner",
    role: "vendor",
    isBlocked: false,
  },
};

function unauthorizedCode(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

function assertRejectedWithCode(
  operation: () => unknown,
  code: string
): void {
  assert.throws(
    operation,
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, code);
      return true;
    }
  );
}

function runVendorMiddleware(
  auth: Auth,
  headers: Record<string, string>
): Promise<{ locals: Record<string, unknown>; error?: unknown }> {
  const res = { locals: {} as Record<string, unknown> };

  return new Promise((resolve) => {
    requireVendor(auth)(
      { headers } as Request,
      { locals: res.locals } as Response,
      ((error?: unknown) => {
        resolve({ locals: res.locals, error });
      }) as NextFunction
    );
  });
}

test("session expiry is validated before role checks", () => {
  const now = Date.parse("2026-11-21T12:00:00.000Z");

  assert.equal(hasValidSessionExpiry("2026-11-21T13:00:00.000Z", now), true);
  assert.equal(hasValidSessionExpiry("2026-11-21T11:00:00.000Z", now), false);
  assert.equal(hasValidSessionExpiry(undefined, now), false);
  assert.equal(hasValidSessionExpiry("not-a-date", now), false);
});

test("only active vendor sessions are authorized", () => {
  assert.deepEqual(authorizeVendorSession(vendorSession), {
    id: vendorSession.user.id,
    email: vendorSession.user.email,
    name: vendorSession.user.name,
  });
});

test("missing, customer, and blocked sessions are rejected", () => {
  assertRejectedWithCode(
    () => authorizeVendorSession(null),
    "UNAUTHORIZED"
  );
  assertRejectedWithCode(
    () =>
      authorizeVendorSession({
        ...vendorSession,
        session: { expiresAt: "2020-01-01T00:00:00.000Z" },
      }),
    "UNAUTHORIZED"
  );
  assertRejectedWithCode(
    () =>
      authorizeVendorSession({
        session: vendorSession.session,
        user: { role: "customer" },
      }),
    "VENDOR_ACCESS_REQUIRED"
  );
  assertRejectedWithCode(
    () =>
      authorizeVendorSession({
        ...vendorSession,
        user: { ...vendorSession.user, isBlocked: true },
      }),
    "ACCOUNT_BLOCKED"
  );
});

test("vendor middleware forwards cookies and derives identity from the session", async () => {
  let forwardedCookie: string | null = null;
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        forwardedCookie = headers.get("cookie");
        return vendorSession;
      },
    },
  } as unknown as Auth;

  const result = await runVendorMiddleware(auth, {
    cookie: "better-auth.session_token=abc123",
  });

  assert.equal(result.error, undefined);
  assert.equal(forwardedCookie, "better-auth.session_token=abc123");
  assert.deepEqual(result.locals.vendor, {
    id: vendorSession.user.id,
    email: vendorSession.user.email,
    name: vendorSession.user.name,
  });
});

test("vendor middleware rejects customers without setting vendor identity", async () => {
  const auth = {
    api: {
      getSession: async () => ({
        session: vendorSession.session,
        user: { ...vendorSession.user, role: "customer" },
      }),
    },
  } as unknown as Auth;

  const result = await runVendorMiddleware(auth, { cookie: "session=abc" });

  assert.equal(unauthorizedCode(result.error), "VENDOR_ACCESS_REQUIRED");
  assert.equal(result.locals.vendor, undefined);
});
