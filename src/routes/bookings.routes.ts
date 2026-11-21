import { Router } from "express";
import type { Db } from "mongodb";
import type { Auth } from "../lib/auth.js";
import { createBookingController } from "../controllers/bookings.controller.js";
import { requireCustomer } from "../middleware/require-customer.js";
import { validate } from "../middleware/validate.js";
import { createBookingSchema } from "../validators/booking.validator.js";

export function createBookingsRouter(auth: Auth, db?: Db) {
  const router = Router();

  router.post(
    "/",
    requireCustomer(auth),
    validate(createBookingSchema, "body"),
    createBookingController(db)
  );

  return router;
}
