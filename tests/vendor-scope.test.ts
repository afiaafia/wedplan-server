import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { AppError } from "../src/errors/app-error.js";
import { getVendorDashboardStats } from "../src/models/dashboard.model.js";
import {
  buildPublicFilter,
  buildVendorServiceFilter,
} from "../src/models/service.model.js";
import { getVendorEffectivePlan } from "../src/services/subscription-plan.service.js";

const vendorId = "507f1f77bcf86cd799439011";
const otherVendorId = "507f1f77bcf86cd799439012";
const serviceId = "507f1f77bcf86cd799439099";

test("service updates are scoped to the authenticated vendor", () => {
  const ownFilter = buildVendorServiceFilter(vendorId, serviceId);
  const otherFilter = buildVendorServiceFilter(otherVendorId, serviceId);

  assert.deepEqual(ownFilter._id, new ObjectId(serviceId));
  assert.equal(ownFilter.vendorId, vendorId);
  assert.equal(otherFilter.vendorId, otherVendorId);
  assert.notDeepEqual(ownFilter, otherFilter);
});

test("invalid service ids cannot construct a vendor-scoped filter", () => {
  assert.throws(() => buildVendorServiceFilter(vendorId, "not-an-object-id"));
});

test("public services require approved and active status", () => {
  const filter = buildPublicFilter({
    sort: "newest",
    page: 1,
    limit: 9,
  });

  assert.equal(filter.approvalStatus, "approved");
  assert.equal(filter.isActive, true);
  assert.notDeepEqual(filter, { approvalStatus: "pending", isActive: true });
});

test("plan lookup rejects invalid authenticated vendor ids", async () => {
  await assert.rejects(
    getVendorEffectivePlan("not-an-object-id"),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    }
  );
});

test("dashboard statistics come from vendor-scoped counts", async () => {
  const seen: string[] = [];
  const track =
    (value: number) =>
    async (id: string): Promise<number> => {
      seen.push(id);
      return value;
    };

  const stats = await getVendorDashboardStats(vendorId, {
    countTotal: track(7),
    countActive: track(3),
    countPending: track(2),
    countBookings: track(11),
  });

  assert.deepEqual(stats, {
    totalServices: 7,
    activeServices: 3,
    pendingApproval: 2,
    totalBookings: 11,
  });
  assert.deepEqual(seen, [vendorId, vendorId, vendorId, vendorId]);
});
