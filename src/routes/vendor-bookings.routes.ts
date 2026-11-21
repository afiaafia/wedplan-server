import { Router } from "express";
import {
  getVendorBooking,
  listVendorBookings,
  processVendorBooking,
} from "../controllers/vendor-bookings.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireVendor } from "../middleware/require-vendor.js";
import { validate } from "../middleware/validate.js";
import {
  bookingStatusActionSchema,
  mongoIdParamSchema,
  vendorBookingsQuerySchema,
} from "../validators/dashboard.validator.js";

export function createVendorBookingsRouter(auth: Auth) {
  const router = Router();

  router.use(requireVendor(auth));

  router.get("/", validate(vendorBookingsQuerySchema, "query"), listVendorBookings);

  router.get("/:id", validate(mongoIdParamSchema, "params"), getVendorBooking);

  router.patch(
    "/:id/status",
    validate(mongoIdParamSchema, "params"),
    validate(bookingStatusActionSchema, "body"),
    processVendorBooking
  );

  return router;
}
