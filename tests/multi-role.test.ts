import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Db } from "mongodb";
import { errorHandler } from "../src/middleware/error-handler.js";
import type { Auth } from "../src/lib/auth.js";
import { createProfileRouter } from "../src/routes/profile.routes.js";
import { activateVendorAccess } from "../src/services/role-onboarding.service.js";

const CUSTOMER_ID = "507f1f77bcf86cd799439011";
const sessionExpiry = "2999-01-01T00:00:00.000Z";

function fakeDatabase(
  user: { role?: unknown; roles?: unknown; isBlocked?: unknown },
  onUpdate?: (filter: Record<string, unknown>, update: Record<string, unknown>) => void
): Db {
  const collection = {
    findOne: async () => user,
    updateOne: async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      onUpdate?.(filter, update);
      const addToSet = update.$addToSet as { roles?: unknown } | undefined;
      if (typeof addToSet?.roles === "string" && Array.isArray(user.roles)) {
        user.roles = [...user.roles, addToSet.roles];
      }
      return { matchedCount: 1 };
    },
  };
  return {
    collection: () => collection,
  } as unknown as Db;
}

function fakeAuth(user: Record<string, unknown> | null): Auth {
  return {
    api: {
      getSession: async () =>
        user
          ? {
              session: { expiresAt: sessionExpiry },
              user: {
                id: CUSTOMER_ID,
                email: "shared@example.com",
                name: "Shared User",
                role: "customer",
                roles: ["customer"],
                isBlocked: false,
                ...user,
              },
            }
          : null,
    },
  } as unknown as Auth;
}

async function withProfileServer(
  auth: Auth,
  db: Db,
  action: (url: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/me", createProfileRouter(auth, undefined, db));
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("customer onboarding adds Vendor capability to the authenticated user only", async () => {
  const user = { role: "customer", roles: ["customer"], isBlocked: false };
  let updatedId = "";
  const db = fakeDatabase(user, (filter, update) => {
    updatedId = String(filter._id);
    assert.deepEqual(update.$addToSet, { roles: "vendor" });
    assert.deepEqual((filter.roles as Record<string, unknown>).$all, ["customer"]);
    assert.deepEqual((filter.roles as Record<string, unknown>).$nin, ["admin"]);
  });

  const roles = await activateVendorAccess(CUSTOMER_ID, db);

  assert.equal(updatedId, CUSTOMER_ID);
  assert.deepEqual(roles, ["customer", "vendor"]);
  assert.deepEqual(user.roles, ["customer", "vendor"]);
});

test("existing Vendor access is idempotent and Admin cannot self-add roles", async () => {
  const vendorDb = fakeDatabase({
    role: "vendor",
    roles: ["vendor"],
    isBlocked: false,
  }, () => assert.fail("Existing Vendor access must not be updated"));
  assert.deepEqual(await activateVendorAccess(CUSTOMER_ID, vendorDb), ["vendor"]);

  const adminDb = fakeDatabase({
    role: "admin",
    roles: ["admin"],
    isBlocked: false,
  }, () => assert.fail("Admin onboarding must be denied"));
  await assert.rejects(
    activateVendorAccess(CUSTOMER_ID, adminDb),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ADMIN_ROLE_PROTECTED"
  );
});

test("blocked users cannot activate Vendor access", async () => {
  const db = fakeDatabase({
    role: "customer",
    roles: ["customer"],
    isBlocked: true,
  }, () => assert.fail("Blocked accounts must not be updated"));

  await assert.rejects(
    activateVendorAccess(CUSTOMER_ID, db),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ACCOUNT_BLOCKED"
  );
});

test("unauthenticated requests cannot trigger the role-onboarding endpoint", async () => {
  const db = fakeDatabase({ role: "customer", roles: ["customer"] }, () =>
    assert.fail("Unauthenticated requests must not reach onboarding")
  );

  await withProfileServer(fakeAuth(null), db, async (url) => {
    const response = await fetch(`${url}/api/me/roles/vendor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone-else@example.com", role: "vendor" }),
    });

    assert.equal(response.status, 401);
  });
});

test("onboarding ignores client-supplied identity and role data", async () => {
  const user = { role: "customer", roles: ["customer"], isBlocked: false };
  let updatedId = "";
  const db = fakeDatabase(user, (filter) => {
    updatedId = String(filter._id);
  });

  await withProfileServer(fakeAuth({}), db, async (url) => {
    const response = await fetch(`${url}/api/me/roles/vendor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "507f1f77bcf86cd799439099",
        email: "someone-else@example.com",
        role: "admin",
        roles: ["admin"],
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      success: boolean;
      data: { roles: string[] };
    };
    assert.equal(body.success, true);
    assert.deepEqual(body.data.roles, ["customer", "vendor"]);
  });

  assert.equal(updatedId, CUSTOMER_ID);
  assert.deepEqual(user.roles, ["customer", "vendor"]);
});
