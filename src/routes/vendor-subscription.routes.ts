import { Router } from "express";
import { getVendorSubscription } from "../controllers/vendor-subscription.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireVendor } from "../middleware/require-vendor.js";

export function createVendorSubscriptionRouter(auth: Auth) {
  const router = Router();

  router.use(requireVendor(auth));
  router.get("/", getVendorSubscription);

  return router;
}
