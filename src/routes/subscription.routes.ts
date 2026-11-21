import { Router } from "express";
import type { Auth } from "../lib/auth.js";
import { requireVendor } from "../middleware/require-vendor.js";
import { createCheckoutSession } from "../controllers/subscription.controller.js";

export function createSubscriptionRouter(auth: Auth) {
  const router = Router();

  router.post(
    "/checkout",
    requireVendor(auth),
    createCheckoutSession
  );

  return router;
}
