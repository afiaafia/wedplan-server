import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import {
  findAdminBookingById,
  findAdminBookings,
} from "../models/booking.model.js";
import type { AdminBookingsQuery } from "../validators/dashboard.validator.js";

type BookingIdParams = { id: string };

export const listAdminBookings = asyncHandler(async (req, res) => {
  const query = Object.keys(req.query).length
    ? getValidated<AdminBookingsQuery>(res)
    : ({
        page: 1,
        limit: 10,
      } satisfies AdminBookingsQuery);
  const result = await findAdminBookings(query);

  res.status(200).json({
    success: true,
    data: result.bookings,
    meta: result.meta,
  });
});

export const getAdminBooking = asyncHandler(async (_req, res) => {
  const { id } = getValidated<BookingIdParams>(res);
  const booking = await findAdminBookingById(id);

  if (!booking) {
    throw new AppError(404, "BOOKING_NOT_FOUND", "Booking request not found");
  }

  res.status(200).json({ success: true, data: booking });
});
