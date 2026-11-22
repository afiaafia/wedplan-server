import test from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../src/errors/app-error.js";
import type { Auth } from "../src/lib/auth.js";
import {
  getRegistrationUserData,
  hasProtectedUserUpdate,
  isOAuthCallbackPath,
  resolveRegistrationUserData,
  sanitizeUserUpdate,
  validatePasswordPolicy,
} from "../src/lib/auth.js";
import { authorizeAdminSession } from "../src/middleware/require-admin.js";
import {
  authorizeSession,
  requireSession,
  type SessionSnapshot,
} from "../src/middleware/require-auth.js";
import { authorizeCustomerSession } from "../src/middleware/require-customer.js";
import { authorizeVendorSession } from "../src/middleware/require-vendor.js";
import {
  BETTER_AUTH_CLIENT_IP_HEADER,
  setBetterAuthClientIp,
} from "../src/middleware/better-auth-client-ip.js";
import { updateProfileSchema } from "../src/validators/profile.validator.js";
import { normalizeUserRole } from "../src/validators/user.validator.js";

const baseSession: SessionSnapshot = {
  session: { expiresAt: "2999-01-01T00:00:00.000Z" },
  user: {
    id: "507f1f77bcf86cd799439011",
    email: "customer@example.com",
    name: "Customer Name",
    role: "customer",
    isBlocked: false,
  },
};

function withUser(overrides: Record<string, unknown>): SessionSnapshot {
  return {
    session: baseSession.session,
    user: { ...baseSession.user, ...overrides },
  };
}

function codeOf(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

function assertRejected(operation: () => unknown, code: string): void {
  assert.throws(
    operation,
    (error: unknown) => {
      assert.equal(codeOf(error), code);
      return true;
    }
  );
}

test("password policy requires six characters, upper and lower case", () => {
  assert.equal(validatePasswordPolicy("GoodPass1"), null);
  assert.match(validatePasswordPolicy("short") ?? "", /at least 6/);
  assert.match(validatePasswordPolicy("alllowercase") ?? "", /uppercase/);
  assert.match(validatePasswordPolicy("ALLUPPERCASE") ?? "", /lowercase/);
  assert.equal(validatePasswordPolicy(undefined), "Password is required");
  assert.match(validatePasswordPolicy("A".repeat(129)) ?? "", /at most 128/);
});

test("Better Auth rate limiting uses the Express-resolved client IP, not a supplied hint", () => {
  const request = {
    ip: "198.51.100.10",
    headers: {
      [BETTER_AUTH_CLIENT_IP_HEADER]: "203.0.113.99",
      "x-forwarded-for": "203.0.113.99",
    },
  } as Request;

  setBetterAuthClientIp(request);

  assert.equal(request.headers[BETTER_AUTH_CLIENT_IP_HEADER], "198.51.100.10");
  assert.equal(request.headers["x-forwarded-for"], "203.0.113.99");
});

test("registration defaults to customer and rejects admin or arbitrary roles", () => {
  assert.equal(resolveRegistrationUserData({}, undefined).role, "customer");
  assert.equal(resolveRegistrationUserData({}, { role: "vendor" }).role, "vendor");
  assert.equal(resolveRegistrationUserData({}, { role: "admin" }).role, "customer");
  assert.equal(resolveRegistrationUserData({}, { role: "root" }).role, "customer");
  assert.equal(
    resolveRegistrationUserData({}, { role: { nested: "admin" } }).role,
    "customer"
  );
});

test("OAuth callback path reads the requested customer or vendor role from Better Auth state", () => {
  assert.equal(isOAuthCallbackPath("/callback/google"), true);
  assert.equal(isOAuthCallbackPath("/callback"), false);
  assert.equal(isOAuthCallbackPath("/callback/google/extra"), false);

  const vendorData = getRegistrationUserData(
    "/callback/google",
    undefined,
    { role: "vendor" }
  );
  const customerData = getRegistrationUserData(
    "/callback/google",
    undefined,
    { role: "customer" }
  );

  assert.equal(resolveRegistrationUserData({}, vendorData).role, "vendor");
  assert.equal(resolveRegistrationUserData({}, customerData).role, "customer");
  assert.deepEqual(
    getRegistrationUserData(
      "/sign-up/email",
      { registrationRole: "vendor", role: "admin" },
      null
    ),
    { role: "vendor" }
  );
  assert.equal(
    resolveRegistrationUserData(
      {},
      getRegistrationUserData(
        "/sign-up/email",
        { registrationRole: "customer" },
        null
      )
    ).role,
    "customer"
  );
});

test("Google sign-in does not change roles on existing customer or vendor accounts", () => {
  const updatedCustomer = {
    role: "customer",
    ...sanitizeUserUpdate({ name: "Updated from Google", role: "vendor" }),
  };
  const updatedVendor = {
    role: "vendor",
    ...sanitizeUserUpdate({ name: "Updated from Google", role: "customer" }),
  };

  assert.equal(updatedCustomer.role, "customer");
  assert.equal(updatedVendor.role, "vendor");
});

test("OAuth registration cannot create admins, blocked users, or premium users", () => {
  const created = resolveRegistrationUserData(
    {
      name: "Google User",
      email: "google@example.com",
      role: "admin",
      isBlocked: true,
      subscriptionPlan: "premium",
      subscriptionExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
      stripeSubscriptionId: "sub_attacker",
    },
    undefined
  );

  assert.equal(created.role, "customer");
  assert.equal(created.isBlocked, false);
  assert.equal(created.subscriptionPlan, "free");
  assert.equal(created.subscriptionExpiresAt, undefined);
  assert.equal(created.stripeSubscriptionId, undefined);
  assert.equal(created.businessName, undefined);
});

test("business names from registration are accepted only for vendors", () => {
  assert.equal(
    resolveRegistrationUserData({}, { role: "vendor", businessName: "  Grace Events  " })
      .businessName,
    "Grace Events"
  );
  assert.equal(
    resolveRegistrationUserData({}, { role: "customer", businessName: "Grace Events" })
      .businessName,
    undefined
  );
});

test("existing admin and vendor roles are preserved", () => {
  assert.equal(normalizeUserRole("admin"), "admin");
  assert.equal(normalizeUserRole("vendor"), "vendor");
  assert.equal(codeOf(undefined), undefined);
  assert.doesNotThrow(() => authorizeSession(withUser({ role: "admin" })));
  assert.doesNotThrow(() => authorizeSession(withUser({ role: "vendor" })));
});

test("protected user fields cannot be changed through profile updates", () => {
  assert.equal(hasProtectedUserUpdate({ name: "New Name", image: null }), false);
  for (const field of [
    "role",
    "isBlocked",
    "subscriptionPlan",
    "subscriptionExpiresAt",
    "stripeSubscriptionId",
  ]) {
    assert.equal(hasProtectedUserUpdate({ [field]: "changed" }), true);
    assert.equal(sanitizeUserUpdate({ name: "A", [field]: "changed" })[field], undefined);
  }
  assert.deepEqual(
    sanitizeUserUpdate({
      name: "New Name",
      image: "https://example.com/a.png",
      businessName: "Grace Events",
      role: "admin",
    }),
    {
      name: "New Name",
      image: "https://example.com/a.png",
      businessName: "Grace Events",
    }
  );
});

test("profile validator rejects ownership, role, and subscription fields", () => {
  for (const body of [
    { userId: "507f1f77bcf86cd799439012" },
    { role: "admin" },
    { isBlocked: false },
    { subscriptionPlan: "premium" },
  ]) {
    assert.equal(updateProfileSchema.safeParse(body).success, false);
  }
  assert.equal(
    updateProfileSchema.safeParse({ name: "New Name", businessName: "Grace Events" })
      .success,
    true
  );
});

test("missing, expired, malformed, and blocked sessions are rejected", () => {
  assertRejected(() => authorizeSession(null), "UNAUTHORIZED");
  assertRejected(
    () =>
      authorizeSession({
        session: { expiresAt: "2020-01-01T00:00:00.000Z" },
        user: baseSession.user,
      }),
    "UNAUTHORIZED"
  );
  assertRejected(() => authorizeSession(withUser({ id: undefined })), "UNAUTHORIZED");
  assertRejected(() => authorizeSession(withUser({ isBlocked: true })), "ACCOUNT_BLOCKED");
});

test("role checks are enforced independently for customers, vendors, and admins", () => {
  const customerSession = withUser({ role: "customer" });
  const vendorSession = withUser({ role: "vendor" });
  const adminSession = withUser({ role: "admin" });

  assert.equal(authorizeCustomerSession(customerSession).id, baseSession.user.id);
  assert.equal(authorizeVendorSession(vendorSession).id, baseSession.user.id);
  assert.equal(authorizeAdminSession(adminSession).id, baseSession.user.id);

  assertRejected(() => authorizeCustomerSession(vendorSession), "CUSTOMER_ACCESS_REQUIRED");
  assertRejected(() => authorizeVendorSession(customerSession), "VENDOR_ACCESS_REQUIRED");
  assertRejected(() => authorizeAdminSession(customerSession), "ADMIN_ACCESS_REQUIRED");
  assertRejected(
    () => authorizeAdminSession(withUser({ role: "admin", isBlocked: true })),
    "ACCOUNT_BLOCKED"
  );
});

test("sign-out invalidates the session used by protected middleware", async () => {
  let active: SessionSnapshot | null = baseSession;
  const auth = {
    api: {
      getSession: async () => active,
      signOut: async () => {
        active = null;
      },
    },
  } as unknown as Auth;

  const middleware = requireSession(auth);
  const run = () =>
    new Promise<{ error?: unknown; locals: Record<string, unknown> }>((resolve) => {
      const locals: Record<string, unknown> = {};
      middleware(
        { headers: {} } as Request,
        { locals } as Response,
        ((error?: unknown) => resolve({ error, locals })) as NextFunction
      );
    });

  const before = await run();
  assert.equal(before.error, undefined);
  assert.equal((before.locals.user as { id: string }).id, baseSession.user.id);

  await auth.api.signOut();

  const after = await run();
  assertRejected(() => {
    if (after.error) throw after.error;
  }, "UNAUTHORIZED");
  assert.equal(after.locals.user, undefined);
});
