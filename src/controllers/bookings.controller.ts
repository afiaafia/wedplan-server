import type { Db } from "mongodb";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import { createBookingRequest } from "../services/booking.service.js";
import type { CreateBookingBody } from "../validators/booking.validator.js";

export function createBookingController(db?: Db) {
  return asyncHandler(async (_req, res) => {
    const input = getValidated<CreateBookingBody>(res);
    const customerId = res.locals.customer.id;

    const booking = await createBookingRequest(customerId, input, db);

    res.status(201).json({
      success: true,
      data: booking,
    });
  });
}
