import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUserRole,
  resolveRegistrationRole,
} from "../src/validators/user.validator.js";

test("registration accepts only public self-assignable roles", () => {
  assert.equal(resolveRegistrationRole("customer"), "customer");
  assert.equal(resolveRegistrationRole("vendor"), "vendor");
});

test("registration cannot self-assign admin or arbitrary values", () => {
  assert.equal(resolveRegistrationRole("admin"), "customer");
  assert.equal(resolveRegistrationRole("superuser"), "customer");
  assert.equal(resolveRegistrationRole({ role: "vendor" }), "customer");
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
