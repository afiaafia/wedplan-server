import { Router } from "express";
import type { Auth } from "../lib/auth.js";
import {
  defaultPaymentDependencies,
  type PaymentDependencies,
} from "../config/payments.js";
import { requireVendor } from "../middleware/require-vendor.js";
import { createCheckoutSessionController } from "../controllers/subscription.controller.js";

export function createSubscriptionRouter(
  auth: Auth,
  deps: PaymentDependencies = defaultPaymentDependencies
) {
  const router = Router();
  const checkoutHandler = createCheckoutSessionController(deps);

  router.post("/checkout", requireVendor(auth), checkoutHandler);
  router.post(
    "/create-checkout-session",
    requireVendor(auth),
    checkoutHandler
  );

  return router;
}
