import test from "node:test";
import assert from "node:assert/strict";
import {
  FREE_ACTIVE_SERVICE_LIMIT,
  canActivateWithPlan,
  getActiveServiceLimit,
  parseSubscriptionExpiry,
  resolveEffectivePlan,
} from "../src/services/subscription-plan.service.js";

const now = new Date("2026-11-21T12:00:00.000Z");

test("free vendors are limited to three active services", () => {
  assert.equal(FREE_ACTIVE_SERVICE_LIMIT, 3);
  assert.equal(getActiveServiceLimit("free"), 3);
  assert.equal(getActiveServiceLimit("premium"), null);
});

test("only a non-expired premium database value grants unlimited services", () => {
  assert.equal(
    resolveEffectivePlan({ subscriptionPlan: "free" }, now),
    "free"
  );
  assert.equal(
    resolveEffectivePlan(
      { subscriptionPlan: "premium", subscriptionExpiresAt: new Date("2026-12-01T00:00:00.000Z") },
      now
    ),
    "premium"
  );
});

test("expired premium is treated as free", () => {
  assert.equal(
    resolveEffectivePlan(
      { subscriptionPlan: "premium", subscriptionExpiresAt: new Date("2026-11-20T00:00:00.000Z") },
      now
    ),
    "free"
  );
  assert.equal(
    resolveEffectivePlan(
      { subscriptionPlan: "premium", subscriptionExpiresAt: now },
      now
    ),
    "free"
  );
  assert.equal(
    resolveEffectivePlan(
      { subscriptionPlan: "premium", subscriptionExpiresAt: "2026-11-01T00:00:00.000Z" },
      now
    ),
    "free"
  );
  assert.equal(
    resolveEffectivePlan(
      { subscriptionPlan: "premium", subscriptionExpiresAt: Date.parse("2026-11-01T00:00:00.000Z") },
      now
    ),
    "free"
  );
});

test("missing, null, or malformed expiry never grants premium", () => {
  for (const subscriptionExpiresAt of [undefined, null, "not-a-date", NaN, Infinity, {}, ""]) {
    assert.equal(
      resolveEffectivePlan(
        { subscriptionPlan: "premium", subscriptionExpiresAt },
        now
      ),
      "free"
    );
  }
});

test("valid future expiry preserves an active premium subscription", () => {
  const future = new Date("2027-01-01T00:00:00.000Z");

  assert.equal(
    resolveEffectivePlan(
      { subscriptionPlan: "premium", subscriptionExpiresAt: future },
      now
    ),
    "premium"
  );
  assert.equal(
    resolveEffectivePlan(
      { subscriptionPlan: "premium", subscriptionExpiresAt: future.toISOString() },
      now
    ),
    "premium"
  );
  assert.equal(
    resolveEffectivePlan(
      { subscriptionPlan: "premium", subscriptionExpiresAt: future.getTime() },
      now
    ),
    "premium"
  );
  assert.equal(parseSubscriptionExpiry(future, now.getTime()), future.getTime());
  assert.equal(parseSubscriptionExpiry(undefined, now.getTime()), null);
});

test("plan decides whether another service can be activated", () => {
  assert.equal(canActivateWithPlan("free", 0), true);
  assert.equal(canActivateWithPlan("free", 2), true);
  assert.equal(canActivateWithPlan("free", 3), false);
  assert.equal(canActivateWithPlan("free", 4), false);
  assert.equal(canActivateWithPlan("premium", 0), true);
  assert.equal(canActivateWithPlan("premium", 4), true);
  assert.equal(canActivateWithPlan("premium", 999), true);
});
