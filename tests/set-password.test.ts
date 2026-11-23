import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Auth } from "../src/lib/auth.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { createProfileRouter } from "../src/routes/profile.routes.js";

const adminSession = {
  session: { expiresAt: new Date(Date.now() + 60_000) },
  user: {
    id: "admin-user-id",
    email: "admin@example.com",
    name: "Admin",
    role: "admin",
    roles: ["admin"],
    isBlocked: false,
  },
};

async function withPasswordServer(
  auth: Auth,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/me", createProfileRouter(auth));
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createAuthMock(options: {
  session?: typeof adminSession | null;
  accounts?: Array<{ providerId: string }>;
  setPassword?: (input: {
    headers: Headers;
    body: { newPassword: string };
  }) => Promise<{ status: boolean }>;
}) {
  const calls: {
    password?: {
      headers: Headers;
      body: { newPassword: string };
    };
  } = {};
  const auth = {
    api: {
      getSession: async () => options.session ?? null,
      listUserAccounts: async () => options.accounts ?? [],
      setPassword: async (input: {
        headers: Headers;
        body: { newPassword: string };
      }) => {
        calls.password = input;
        return options.setPassword
          ? options.setPassword(input)
          : { status: true };
      },
    },
  } as unknown as Auth;

  return { auth, calls };
}

test("admin password setup uses the authenticated Better Auth session", async () => {
  const { auth, calls } = createAuthMock({
    session: adminSession,
    accounts: [{ providerId: "google" }],
  });

  await withPasswordServer(auth, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "better-auth.session_token=test-session",
      },
      body: JSON.stringify({ newPassword: "AdminPass1" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: { passwordSet: true },
    });
    assert.ok(calls.password?.headers instanceof Headers);
    assert.equal(
      calls.password?.headers.get("cookie"),
      "better-auth.session_token=test-session"
    );
    assert.equal(calls.password?.body.newPassword, "AdminPass1");
    assert.equal("userId" in (calls.password?.body ?? {}), false);
  });
});

test("password setup rejects a body-supplied user id", async () => {
  const { auth, calls } = createAuthMock({
    session: adminSession,
    accounts: [{ providerId: "google" }],
  });

  await withPasswordServer(auth, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newPassword: "AdminPass1",
        userId: "different-user-id",
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(calls.password, undefined);
  });
});

test("password setup requires an active admin Better Auth session", async () => {
  const { auth, calls } = createAuthMock({ session: null });

  await withPasswordServer(auth, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "AdminPass1" }),
    });

    assert.equal(response.status, 401);
    assert.equal(calls.password, undefined);
  });
});

test("password setup rejects a non-admin Google session", async () => {
  const { auth, calls } = createAuthMock({
    session: {
      ...adminSession,
      user: {
        ...adminSession.user,
        role: "customer",
        roles: ["customer"],
      },
    },
    accounts: [{ providerId: "google" }],
  });

  await withPasswordServer(auth, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "AdminPass1" }),
    });

    assert.equal(response.status, 403);
    assert.equal(calls.password, undefined);
  });
});

test("password setup requires the current account to have Google linked", async () => {
  const { auth, calls } = createAuthMock({
    session: adminSession,
    accounts: [{ providerId: "credential" }],
  });

  await withPasswordServer(auth, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "AdminPass1" }),
    });

    assert.equal(response.status, 403);
    assert.equal(calls.password, undefined);
  });
});

test("password setup rejects weak passwords without passing them to Better Auth", async () => {
  const { auth, calls } = createAuthMock({
    session: adminSession,
    accounts: [{ providerId: "google" }],
  });

  await withPasswordServer(auth, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "alllowercase" }),
    });

    assert.equal(response.status, 400);
    assert.equal(calls.password, undefined);
  });
});

test("password setup does not overwrite an existing credential password", async () => {
  const { auth } = createAuthMock({
    session: adminSession,
    accounts: [{ providerId: "google" }],
    setPassword: async () => {
      const error = new Error("password already set") as Error & {
        body: { code: string };
      };
      error.body = { code: "PASSWORD_ALREADY_SET" };
      throw error;
    },
  });

  await withPasswordServer(auth, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "AdminPass1" }),
    });

    assert.equal(response.status, 409);
    const body = await response.text();
    assert.match(body, /PASSWORD_ALREADY_SET/);
    assert.equal(body.includes("AdminPass1"), false);
  });
});
