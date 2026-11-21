import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { AppError } from "../src/errors/app-error.js";
import {
  FREE_PLAN_LIMIT_ERROR_CODE,
  assertCanActivateService,
  isActivationChange,
} from "../src/services/service-limits.service.js";
import {
  ensureServiceCounter,
  reconcileServiceCounter,
  reserveServiceSlot,
  type ServiceCounterDocument,
  type ServiceCounterStore,
} from "../src/services/service-capacity.service.js";
import { resolveEffectivePlan } from "../src/services/subscription-plan.service.js";
import type { SubscriptionPlanName } from "../src/types/user.js";

const vendorId = "507f1f77bcf86cd799439011";

function dependencies(plan: SubscriptionPlanName, activeCount: number) {
  let resolvedFor = "";
  let countedFor = "";

  return {
    resolvePlan: async (id: string) => {
      resolvedFor = id;
      return plan;
    },
    countActive: async (id: string) => {
      countedFor = id;
      return activeCount;
    },
    calls: () => ({ resolvedFor, countedFor }),
  };
}

test("free vendor can activate up to three active services", async () => {
  const deps = dependencies("free", 2);

  await assertCanActivateService(vendorId, deps);

  assert.deepEqual(deps.calls(), {
    resolvedFor: vendorId,
    countedFor: vendorId,
  });
});

test("fourth service is rejected with 403 and the shared error code", async () => {
  const deps = dependencies("free", 3);

  await assert.rejects(
    assertCanActivateService(vendorId, deps),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, FREE_PLAN_LIMIT_ERROR_CODE);
      assert.equal(FREE_PLAN_LIMIT_ERROR_CODE, "FREE_PLAN_LIMIT_REACHED");
      assert.deepEqual(error.details, {
        plan: "free",
        activeServices: 3,
        limit: 3,
      });
      return true;
    }
  );
});

test("over-limit free vendor cannot activate another service", async () => {
  await assert.rejects(
    assertCanActivateService(vendorId, dependencies("free", 5)),
    (error: unknown) =>
      error instanceof AppError && error.code === "FREE_PLAN_LIMIT_REACHED"
  );
});

test("premium vendor has no active service limit", async () => {
  const deps = dependencies("premium", 25);

  await assertCanActivateService(vendorId, deps);

  assert.equal(deps.calls().countedFor, "");
});

test("expired premium is enforced as free after downgrade", async () => {
  const expired = new Date("2026-11-01T00:00:00.000Z");
  const deps = {
    resolvePlan: async () =>
      resolveEffectivePlan(
        { subscriptionPlan: "premium", subscriptionExpiresAt: expired },
        new Date("2026-11-21T00:00:00.000Z")
      ),
    countActive: async () => 3,
  };

  await assert.rejects(
    assertCanActivateService(vendorId, deps),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, "FREE_PLAN_LIMIT_REACHED");
      return true;
    }
  );
});

test("over-limit vendors may still deactivate services", () => {
  assert.equal(isActivationChange(false, true), true);
  assert.equal(isActivationChange(true, true), false);
  assert.equal(isActivationChange(true, false), false);
  assert.equal(isActivationChange(false, false), false);
});

function createAtomicCounterStore(
  initialActiveCount: number
): ServiceCounterStore & { activeCount: () => number } {
  let document: ServiceCounterDocument = {
    _id: new ObjectId(vendorId),
    activeCount: initialActiveCount,
    updatedAt: new Date(),
  };

  return {
    activeCount: () => document.activeCount,
    async findOne(filter) {
      if (!filter._id.equals(document._id)) return null;
      return { ...document };
    },
    async countActive() {
      return document.activeCount;
    },
    async upsertCounter(next) {
      document = { ...next };
    },
    async findOneAndUpdate(filter, update) {
      if (!filter._id.equals(document._id)) return null;
      if (
        filter.activeCount?.$lt !== undefined &&
        document.activeCount >= filter.activeCount.$lt
      ) {
        return null;
      }
      if (
        filter.activeCount?.$gt !== undefined &&
        document.activeCount <= filter.activeCount.$gt
      ) {
        return null;
      }

      document = {
        ...document,
        activeCount: document.activeCount + update.$inc.activeCount,
        updatedAt: update.$set.updatedAt,
      };
      return { ...document };
    },
  };
}

test("counter seeding is idempotent and does not rely on duplicate-key recovery", async () => {
  let document: ServiceCounterDocument | null = null;
  let upserts = 0;
  const store: ServiceCounterStore = {
    async findOne(filter) {
      if (!document || !filter._id.equals(document._id)) return null;
      return { ...document };
    },
    async countActive() {
      return 2;
    },
    async upsertCounter(next) {
      upserts += 1;
      if (!document) document = { ...next };
    },
    async findOneAndUpdate() {
      return null;
    },
  };

  const first = await ensureServiceCounter(vendorId, store);
  const second = await ensureServiceCounter(vendorId, store);

  assert.equal(upserts, 1);
  assert.equal(first.activeCount, 2);
  assert.equal(second.activeCount, 2);
});

test("counter reconciliation repairs stale counters after moderation changes", async () => {
  let stored: { activeCount: number } | null = { activeCount: 9 };
  let upserted = false;

  const db = {
    collection(name: string) {
      if (name === "services") {
        return { countDocuments: async () => 2 };
      }
      return {
        updateOne: async (
          _filter: unknown,
          update: { $set: { activeCount: number } },
          options: { upsert: boolean }
        ) => {
          stored = { activeCount: update.$set.activeCount };
          upserted = options.upsert;
        },
      };
    },
  };

  await reconcileServiceCounter(vendorId, db as never);

  assert.deepEqual(stored, { activeCount: 2 });
  assert.equal(upserted, true);
});

test("concurrent free activations cannot exceed three active services", async () => {
  const store = createAtomicCounterStore(0);

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => reserveServiceSlot(vendorId, store, "free"))
  );

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );

  assert.equal(fulfilled.length, 3);
  assert.equal(rejected.length, 2);
  assert.equal(store.activeCount(), 3);

  for (const result of rejected) {
    assert.ok(result.reason instanceof AppError);
    assert.equal(result.reason.statusCode, 403);
    assert.equal(result.reason.code, FREE_PLAN_LIMIT_ERROR_CODE);
    assert.deepEqual(result.reason.details, {
      plan: "free",
      activeServices: 3,
      limit: 3,
    });
  }
});

test("premium activations are not capped by the free active limit", async () => {
  const store = createAtomicCounterStore(10);

  await Promise.all(
    Array.from({ length: 5 }, () => reserveServiceSlot(vendorId, store, "premium"))
  );

  assert.equal(store.activeCount(), 15);
});
