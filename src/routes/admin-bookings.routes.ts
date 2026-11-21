import { Router } from "express";
import {
  getAdminBooking,
  listAdminBookings,
} from "../controllers/admin-bookings.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { validate } from "../middleware/validate.js";
import {
  adminBookingsQuerySchema,
  mongoIdParamSchema,
} from "../validators/dashboard.validator.js";

export function createAdminBookingsRouter(auth: Auth) {
  const router = Router();

  router.use(requireAdmin(auth));

  router.get("/", validate(adminBookingsQuerySchema, "query"), listAdminBookings);

  router.get("/:id", validate(mongoIdParamSchema, "params"), getAdminBooking);

  return router;
}
