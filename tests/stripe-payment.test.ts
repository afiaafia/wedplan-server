import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { ObjectId, type Db } from "mongodb";
import type { Auth } from "../src/lib/auth.js";
import { createApp } from "../src/app.js";
import { getVendorSubscriptionSummary } from "../src/services/vendor-subscription.service.js";

const VENDOR_ID = "507f1f77bcf86cd799439011";
const VENDOR_EMAIL = "vendor@example.com";
const PRICE_ID = "price_premium_123";
const SESSION_ID = "cs_test_123";
const SUBSCRIPTION_ID = "sub_123";

type StoredDocument = Record<string, unknown> & { _id: ObjectId };
type Tables = Record<string, StoredDocument[]>;

function compareValue(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId || expected instanceof ObjectId) {
    return String(actual) === String(expected);
  }
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return String(actual) === String(expected);
}

function matches(document: StoredDocument, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "$or") {
      const alternatives = expected as Record<string, unknown>[];
      if (!alternatives.some((alternative) => matches(document, alternative))) {
        return false;
      }
      continue;
    }

    const actual = document[key];

    if (expected && typeof expected === "object" && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
      const operator = expected as Record<string, unknown>;
      if ("$ne" in operator) {
        if (compareValue(actual, operator.$ne)) return false;
        continue;
      }
      if ("$in" in operator) {
        if (!(operator.$in as unknown[]).some((value) => compareValue(actual, value))) {
          return false;
        }
        continue;
      }
      if ("$exists" in operator) {
        if ((actual !== undefined) !== operator.$exists) return false;
        continue;
      }
      if ("$gt" in operator && !(Number(actual) > Number(operator.$gt))) return false;
      if ("$lt" in operator && !(Number(actual) < Number(operator.$lt))) return false;
      if ("$regex" in operator) {
        const regex = new RegExp(String(operator.$regex), String(operator.$options ?? ""));
        if (!regex.test(String(actual ?? ""))) return false;
      }
      continue;
    }

    if (!compareValue(actual, expected)) return false;
  }

  return true;
}

function sortDocuments(documents: StoredDocument[], sort: Record<string, number>) {
  const entries = Object.entries(sort);
  return [...documents].sort((left, right) => {
    for (const [key, direction] of entries) {
      const a = left[key];
      const b = right[key];
      const av = a instanceof Date ? a.getTime() : a instanceof ObjectId ? a.toString() : a;
      const bv = b instanceof Date ? b.getTime() : b instanceof ObjectId ? b.toString() : b;
      if (av === bv) continue;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return (av < bv ? -1 : 1) * direction;
    }
    return 0;
  });
}

function createFakeDb(tables: Tables) {
  for (const name of ["transactions", "webhookEvents", "services", "user"]) {
    if (!tables[name]) tables[name] = [];
  }
  const collections = new Map<string, StoredDocument[]>(
    Object.entries(tables).map(([name, docs]) => [name, docs])
  );

  function docs(name: string): StoredDocument[] {
    if (!collections.has(name)) collections.set(name, []);
    return collections.get(name)!;
  }

  function duplicateError(): Error & { code: number } {
    return Object.assign(new Error("duplicate key"), { code: 11000 });
  }

  function applyUpdate(document: StoredDocument, update: Record<string, unknown>) {
    const next = { ...document };
    const onInsert = update.$setOnInsert as Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(onInsert ?? {})) {
      if (!(key in next)) next[key] = value;
    }
    const set = update.$set as Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(set ?? {})) next[key] = value;
    const unset = update.$unset as Record<string, unknown> | undefined;
    for (const key of Object.keys(unset ?? {})) delete next[key];
    return next;
  }

  return {
    tables,
    collection(name: string) {
      const documents = docs(name);
      return {
        async insertOne(document: StoredDocument) {
          if (name === "webhookEvents" && documents.some((item) => item.eventId === document.eventId)) {
            throw duplicateError();
          }
          if (name === "transactions") {
            if (documents.some((item) => item.stripeSessionId === document.stripeSessionId)) {
              throw duplicateError();
            }
            if (
              document.stripeSubscriptionId &&
              documents.some((item) => item.stripeSubscriptionId === document.stripeSubscriptionId)
            ) {
              throw duplicateError();
            }
          }
          documents.push(document);
          return { insertedId: document._id };
        },
        find(filter: Record<string, unknown> = {}) {
          let result = documents.filter((document) => matches(document, filter));
          const cursor = {
            sort(sort: Record<string, number>) {
              result = sortDocuments(result, sort);
              return cursor;
            },
            skip(count: number) {
              result = result.slice(count);
              return cursor;
            },
            limit(count: number) {
              result = result.slice(0, count);
              return cursor;
            },
            async toArray() {
              return result;
            },
          };
          return cursor;
        },
        async findOne(filter: Record<string, unknown> = {}, options?: { sort?: Record<string, number> }) {
          let result = documents.filter((document) => matches(document, filter));
          if (options?.sort) result = sortDocuments(result, options.sort);
          return result[0] ?? null;
        },
        async countDocuments(filter: Record<string, unknown> = {}) {
          return documents.filter((document) => matches(document, filter)).length;
        },
        async findOneAndUpdate(
          filter: Record<string, unknown>,
          update: Record<string, unknown>
        ) {
          const index = documents.findIndex((document) => matches(document, filter));
          if (index === -1) return null;
          const next = applyUpdate(documents[index], update);
          documents[index] = next;
          return next;
        },
        async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
          const index = documents.findIndex((document) => matches(document, filter));
          if (index === -1) return { matchedCount: 0, upsertedCount: 0 };
          documents[index] = applyUpdate(documents[index], update);
          return { matchedCount: 1, upsertedCount: 0 };
        },
      };
    },
  } as unknown as Db & { tables: Tables };
}

function vendorRecord(overrides: Record<string, unknown> = {}): StoredDocument {
  return {
    _id: new ObjectId(VENDOR_ID),
    role: "vendor",
    roles: ["vendor"],
    name: "Vendor One",
    email: VENDOR_EMAIL,
    isBlocked: false,
    subscriptionPlan: "free",
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBSCRIPTION_ID,
    status: "active",
    created: 1_700_000_000,
    metadata: { vendorId: VENDOR_ID, plan: "premium" },
    items: {
      data: [
        {
          current_period_end: 1_702_592_000,
          price: {
            id: PRICE_ID,
            unit_amount: 1000,
            currency: "usd",
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...overrides,
  };
}

type FakeStripeOptions = {
  price?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  event?: Record<string, unknown>;
  createdSessionStatus?: string;
};

function createFakeStripe(options: FakeStripeOptions = {}) {
  const createdSessions: Record<string, unknown>[] = [];
  let event = options.event;

  return {
    createdSessions,
    setEvent(next: Record<string, unknown>) {
      event = next;
    },
    prices: {
      async retrieve(id: string) {
        return {
          id,
          active: true,
          type: "recurring",
          recurring: { interval: "month" },
          unit_amount: 1000,
          currency: "usd",
          ...(options.price ?? {}),
        };
      },
    },
    checkout: {
      sessions: {
        async create(params: Record<string, unknown>) {
          const session = {
            id: SESSION_ID,
            url: "https://checkout.stripe.com/c/pay/cs_test_123",
            ...params,
          };
          createdSessions.push(session);
          return session;
        },
        async retrieve(id: string) {
          const existing = createdSessions.find((session) => session.id === id);
          return {
            id,
            status: options.createdSessionStatus ?? "open",
            url: existing?.url ?? "https://checkout.stripe.com/c/pay/cs_test_123",
          };
        },
      },
    },
    subscriptions: {
      async retrieve() {
        return subscription(options.subscription ?? {});
      },
    },
    webhooks: {
      constructEvent(_body: Buffer, signature: string) {
        if (signature !== "valid-signature") {
          throw new Error("invalid signature");
        }
        if (!event) throw new Error("no event configured");
        return event;
      },
    },
  };
}

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        mode: "subscription",
        payment_status: "paid",
        client_reference_id: VENDOR_ID,
        customer_email: VENDOR_EMAIL,
        subscription: SUBSCRIPTION_ID,
        metadata: { plan: "premium" },
        ...overrides,
      },
    },
  };
}

function pendingTransaction(overrides: Record<string, unknown> = {}): StoredDocument {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    _id: new ObjectId(),
    vendorId: VENDOR_ID,
    vendorEmail: VENDOR_EMAIL,
    plan: "premium",
    amount: 10,
    currency: "usd",
    stripePriceId: PRICE_ID,
    stripeSessionId: SESSION_ID,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sessionUser(overrides: Record<string, unknown> = {}) {
  return {
    session: { expiresAt: "2999-01-01T00:00:00.000Z" },
    user: {
      id: VENDOR_ID,
      email: VENDOR_EMAIL,
      name: "Vendor One",
      role: "vendor",
      isBlocked: false,
      ...overrides,
    },
  };
}

async function startServer(options: {
  db: Db;
  stripe: ReturnType<typeof createFakeStripe>;
  user?: unknown;
  priceId?: string | undefined;
  webhookSecret?: string | undefined;
}) {
  const sessionValue = options.user;
  const auth = {
    api: {
      getSession: async () => sessionValue,
    },
  } as unknown as Auth;

  const app = createApp(auth, {
    db: options.db,
    paymentDependencies: {
      getDb: () => options.db,
      getStripeClient: () => options.stripe as never,
      getPriceId: () => ("priceId" in options ? options.priceId : PRICE_ID),
      getWebhookSecret: () =>
        "webhookSecret" in options ? options.webhookSecret : "whsec_test",
    },
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    request(path: string, init: RequestInit = {}) {
      return fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    },
  };
}

async function closeServer(server: ReturnType<ReturnType<typeof createApp>["listen"]>) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("checkout uses verified session identity and server-controlled plan configuration", async () => {
  const db = createFakeDb({ user: [vendorRecord()] });
  const stripe = createFakeStripe();
  const { server, request } = await startServer({ db, stripe, user: sessionUser() });

  try {
    const response = await request("/api/subscriptions/checkout", {
      method: "POST",
      body: JSON.stringify({
        amount: 1,
        currency: "usd",
        plan: "free",
        vendorId: "000000000000000000000000",
      }),
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.data.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_123");

    const created = stripe.createdSessions[0];
    assert.equal(created.mode, "subscription");
    assert.deepEqual(created.line_items, [{ price: PRICE_ID, quantity: 1 }]);
    assert.equal(created.client_reference_id, VENDOR_ID);
    assert.equal(created.customer_email, VENDOR_EMAIL);
    assert.equal("amount" in created, false);
    assert.equal(db.tables.transactions?.length, 1);
    assert.equal(db.tables.transactions?.[0].status, "pending");
    assert.equal(db.tables.user?.[0].subscriptionPlan, "free");
  } finally {
    await closeServer(server);
  }
});

test("checkout rejects guests, customers, and blocked vendors", async () => {
  for (const [user, expectedStatus] of [
    [null, 401],
    [sessionUser({ role: "customer" }), 403],
    [sessionUser({ isBlocked: true }), 403],
  ] as const) {
    const db = createFakeDb({ user: [vendorRecord()] });
    const stripe = createFakeStripe();
    const { server, request } = await startServer({ db, stripe, user });

    try {
      const response = await request("/api/payments/create-checkout-session", {
        method: "POST",
      });
      assert.equal(response.status, expectedStatus);
      assert.equal(stripe.createdSessions.length, 0);
    } finally {
      await closeServer(server);
    }
  }
});

test("checkout rejects an already active Premium vendor without creating a session", async () => {
  const db = createFakeDb({
    user: [
      vendorRecord({
        subscriptionPlan: "premium",
        subscriptionExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
      }),
    ],
  });
  const stripe = createFakeStripe();
  const { server, request } = await startServer({ db, stripe, user: sessionUser() });

  try {
    const response = await request("/api/subscriptions/checkout", { method: "POST" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, "PREMIUM_ALREADY_ACTIVE");
    assert.equal(stripe.createdSessions.length, 0);
  } finally {
    await closeServer(server);
  }
});

test("checkout reports missing configuration with a safe error", async () => {
  const db = createFakeDb({ user: [vendorRecord()] });
  const stripe = createFakeStripe();
  const { server, request } = await startServer({
    db,
    stripe,
    user: sessionUser(),
    priceId: undefined,
  });

  try {
    const response = await request("/api/subscriptions/checkout", { method: "POST" });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, "STRIPE_PRICE_NOT_CONFIGURED");
    assert.equal(stripe.createdSessions.length, 0);
  } finally {
    await closeServer(server);
  }
});

async function postWebhook(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  body: unknown,
  signature = "valid-signature"
) {
  return request("/api/payments/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: JSON.stringify(body),
  });
}

test("webhook rejects invalid signatures without changing subscription state", async () => {
  const db = createFakeDb({
    user: [vendorRecord()],
    transactions: [pendingTransaction()],
  });
  const stripe = createFakeStripe({ event: checkoutEvent() });
  const { server, request } = await startServer({ db, stripe, user: sessionUser() });

  try {
    const response = await postWebhook(request, {}, "bad-signature");
    assert.equal(response.status, 400);
    assert.equal(db.tables.user?.[0].subscriptionPlan, "free");
    assert.equal(db.tables.transactions?.[0].status, "pending");
  } finally {
    await closeServer(server);
  }
});

test("verified Checkout completion activates Premium after payment validation", async () => {
  const db = createFakeDb({
    user: [vendorRecord()],
    transactions: [pendingTransaction()],
  });
  const stripe = createFakeStripe({ event: checkoutEvent() });
  const { server, request } = await startServer({ db, stripe, user: sessionUser() });

  try {
    const response = await postWebhook(request, {});
    assert.equal(response.status, 200);

    const vendor = db.tables.user?.[0];
    assert.equal(vendor?.subscriptionPlan, "premium");
    assert.equal(vendor?.stripeSubscriptionId, SUBSCRIPTION_ID);
    assert.equal(
      (vendor?.subscriptionExpiresAt as Date).toISOString(),
      new Date(1_702_592_000 * 1000).toISOString()
    );
    assert.equal(db.tables.transactions?.[0].status, "completed");
    assert.equal(db.tables.transactions?.[0].stripeEventId, "evt_checkout_1");
  } finally {
    await closeServer(server);
  }
});

test("failed, incomplete, and unrelated webhook events never activate Premium", async () => {
  const cases = [
    checkoutEvent({ payment_status: "unpaid" }),
    {
      id: "evt_unpaid",
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", subscription: SUBSCRIPTION_ID } },
    },
    { id: "evt_unrelated", type: "customer.created", data: { object: {} } },
  ];

  for (const event of cases) {
    const db = createFakeDb({
      user: [vendorRecord()],
      transactions: [pendingTransaction()],
    });
    const stripe = createFakeStripe({ event });
    const { server, request } = await startServer({ db, stripe, user: sessionUser() });

    try {
      const response = await postWebhook(request, {});
      assert.equal(response.status, 200);
      assert.equal(db.tables.user?.[0].subscriptionPlan, "free");
    } finally {
      await closeServer(server);
    }
  }
});

test("incorrect price, currency, and plan data is rejected by the webhook", async () => {
  const variations = [
    { price: { unit_amount: 999 } },
    { price: { currency: "eur" } },
    { subscription: { metadata: { vendorId: VENDOR_ID, plan: "free" } } },
    { subscription: { metadata: { vendorId: "000000000000000000000000", plan: "premium" } } },
  ];

  for (const variation of variations) {
    const db = createFakeDb({
      user: [vendorRecord()],
      transactions: [pendingTransaction()],
    });
    const stripe = createFakeStripe({
      event: checkoutEvent(),
      ...variation,
    });
    const { server, request } = await startServer({ db, stripe, user: sessionUser() });

    try {
      const response = await postWebhook(request, {});
      assert.equal(response.status, 500);
      assert.equal(db.tables.user?.[0].subscriptionPlan, "free");
    } finally {
      await closeServer(server);
    }
  }
});

test("unknown Checkout sessions are safely ignored", async () => {
  const db = createFakeDb({ user: [vendorRecord()] });
  const stripe = createFakeStripe({ event: checkoutEvent() });
  const { server, request } = await startServer({ db, stripe, user: sessionUser() });

  try {
    const response = await postWebhook(request, {});
    assert.equal(response.status, 200);
    assert.equal(db.tables.user?.[0].subscriptionPlan, "free");
  } finally {
    await closeServer(server);
  }
});

test("duplicate and repeated events do not extend Premium repeatedly", async () => {
  const db = createFakeDb({
    user: [vendorRecord()],
    transactions: [pendingTransaction()],
  });
  const stripe = createFakeStripe({ event: checkoutEvent() });
  const { server, request } = await startServer({ db, stripe, user: sessionUser() });

  try {
    const first = await postWebhook(request, {});
    assert.equal(first.status, 200);
    const firstExpiry = (db.tables.user?.[0].subscriptionExpiresAt as Date).toISOString();

    const duplicate = await postWebhook(request, {});
    assert.equal((await duplicate.json()).duplicate, true);

    stripe.setEvent({
      id: "evt_subscription_updated",
      type: "customer.subscription.updated",
      data: { object: subscription() },
    });
    const repeated = await postWebhook(request, {});
    assert.equal(repeated.status, 200);

    assert.equal(
      (db.tables.user?.[0].subscriptionExpiresAt as Date).toISOString(),
      firstExpiry
    );
    assert.equal(db.tables.webhookEvents?.length, 2);
  } finally {
    await closeServer(server);
  }
});

test("expired Checkout marks its transaction cancelled without activating Premium", async () => {
  const db = createFakeDb({
    user: [vendorRecord()],
    transactions: [pendingTransaction()],
  });
  const stripe = createFakeStripe({
    event: {
      id: "evt_expired",
      type: "checkout.session.expired",
      data: { object: { id: SESSION_ID, mode: "subscription" } },
    },
  });
  const { server, request } = await startServer({ db, stripe, user: sessionUser() });

  try {
    const response = await postWebhook(request, {});
    assert.equal(response.status, 200);
    assert.equal(db.tables.transactions?.[0].status, "cancelled");
    assert.equal(db.tables.user?.[0].subscriptionPlan, "free");
  } finally {
    await closeServer(server);
  }
});

test("admin can read real transactions but cannot modify their status", async () => {
  const db = createFakeDb({
    user: [vendorRecord()],
    transactions: [pendingTransaction()],
  });
  const stripe = createFakeStripe();
  const { server, request } = await startServer({
    db,
    stripe,
    user: sessionUser({ role: "admin" }),
  });

  try {
    const response = await request("/api/admin/transactions?status=pending&q=Vendor", {
      method: "GET",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].vendorName, "Vendor One");
    assert.equal(body.data[0].vendorEmail, VENDOR_EMAIL);
    assert.equal(body.data[0].stripeSessionId, SESSION_ID);

    const mutation = await request(`/api/admin/transactions/${db.tables.transactions?.[0]._id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(mutation.status, 404);
    assert.equal(db.tables.transactions?.[0].status, "pending");
  } finally {
    await closeServer(server);
  }
});

test("concurrent duplicate webhook deliveries are processed only once", async () => {
  const db = createFakeDb({
    user: [vendorRecord()],
    transactions: [pendingTransaction()],
  });
  const stripe = createFakeStripe({ event: checkoutEvent() });
  const { server, request } = await startServer({ db, stripe, user: sessionUser() });

  try {
    const [first, second] = await Promise.all([
      postWebhook(request, {}),
      postWebhook(request, {}),
    ]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const bodies = await Promise.all([first.json(), second.json()]);
    assert.equal(bodies.filter((body: { duplicate?: boolean }) => body.duplicate).length, 1);
    assert.equal(db.tables.webhookEvents?.length, 1);
    assert.equal(db.tables.user?.[0].subscriptionPlan, "premium");
  } finally {
    await closeServer(server);
  }
});

test("subscription summary derives status and history from backend records", async () => {
  const expiredDb = createFakeDb({
    user: [
      vendorRecord({
        subscriptionPlan: "premium",
        subscriptionExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ],
    transactions: [pendingTransaction({ status: "pending" })],
  });
  const expired = await getVendorSubscriptionSummary(VENDOR_ID, expiredDb);
  assert.equal(expired.plan, "free");
  assert.equal(expired.status, "expired");
  assert.equal(expired.activeServiceLimit, 3);
  assert.equal(expired.recentTransactions.length, 1);

  const pendingDb = createFakeDb({
    user: [vendorRecord()],
    transactions: [pendingTransaction()],
  });
  const pending = await getVendorSubscriptionSummary(VENDOR_ID, pendingDb);
  assert.equal(pending.status, "pending");
  assert.equal(pending.price?.amount, 10);
  assert.equal(pending.price?.currency, "usd");

  const activeDb = createFakeDb({
    user: [
      vendorRecord({
        subscriptionPlan: "premium",
        subscriptionExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
      }),
    ],
  });
  const active = await getVendorSubscriptionSummary(VENDOR_ID, activeDb);
  assert.equal(active.status, "active");
  assert.equal(active.activeServiceLimit, null);
});
