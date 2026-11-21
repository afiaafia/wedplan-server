import { Router } from "express";
import { getVendorDashboard } from "../controllers/vendor-dashboard.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireVendor } from "../middleware/require-vendor.js";

export function createVendorDashboardRouter(auth: Auth) {
  const router = Router();

  router.use(requireVendor(auth));

  router.get("/", getVendorDashboard);

  return router;
}
