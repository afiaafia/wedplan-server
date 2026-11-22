import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRegistrationRole,
  normalizeUserRoles,
  normalizeUserRole,
  resolveRegistrationRole,
} from "../src/validators/user.validator.js";

test("registration accepts only public self-assignable roles", () => {
  assert.equal(resolveRegistrationRole("customer"), "customer");
  assert.equal(resolveRegistrationRole("vendor"), "vendor");
});

test("registration cannot self-assign admin or arbitrary values", () => {
  assert.throws(() => assertRegistrationRole("admin"));
  assert.equal(resolveRegistrationRole("admin"), "customer");
  assert.equal(resolveRegistrationRole("superuser"), "customer");
  assert.equal(resolveRegistrationRole({ role: "vendor" }), "customer");
});

test("role capabilities preserve multiple roles and fall back to legacy role data", () => {
  assert.deepEqual(
    normalizeUserRoles(["customer", "vendor", "admin", "unknown"], "customer"),
    ["customer", "vendor", "admin"]
  );
  assert.deepEqual(normalizeUserRoles(undefined, "vendor"), ["vendor"]);
  assert.deepEqual(normalizeUserRoles([], "customer"), []);
  assert.deepEqual(normalizeUserRoles(["invalid"], "customer"), []);
});

test("registration falls back to customer for OAuth and legacy calls", () => {
  assert.equal(resolveRegistrationRole(undefined), "customer");
  assert.equal(resolveRegistrationRole(null), "customer");
});

test("existing admin and vendor roles are preserved", () => {
  assert.equal(normalizeUserRole("admin"), "admin");
  assert.equal(normalizeUserRole("vendor"), "vendor");
  assert.equal(normalizeUserRole("customer"), "customer");
});

test("legacy users without a role resolve to customer", () => {
  assert.equal(normalizeUserRole(undefined), "customer");
  assert.equal(normalizeUserRole(null), "customer");
  assert.equal(normalizeUserRole(""), "customer");
});
