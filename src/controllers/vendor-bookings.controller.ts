import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import {
  findBookingForVendor,
  findVendorBookings,
  updateVendorBookingStatus,
} from "../models/booking.model.js";
import type {
  BookingStatusAction,
  VendorBookingsQuery,
} from "../validators/dashboard.validator.js";

type BookingIdParams = { id: string };

export const listVendorBookings = asyncHandler(async (_req, res) => {
  const query = getValidated<VendorBookingsQuery>(res);
  const result = await findVendorBookings(res.locals.vendor.id, query);

  res.status(200).json({
    success: true,
    data: result.bookings,
    meta: result.meta,
  });
});

export const getVendorBooking = asyncHandler(async (_req, res) => {
  const { id } = getValidated<BookingIdParams>(res);
  const booking = await findBookingForVendor(res.locals.vendor.id, id);

  if (!booking) {
    throw new AppError(404, "BOOKING_NOT_FOUND", "Booking request not found");
  }

  res.status(200).json({ success: true, data: booking });
});

export const processVendorBooking = asyncHandler(async (_req, res) => {
  const { id } = getValidated<BookingIdParams>(res);
  const { action } = getValidated<BookingStatusAction>(res);

  const booking = await updateVendorBookingStatus(
    res.locals.vendor.id,
    id,
    action
  );

  res.status(200).json({
    success: true,
    message:
      action === "accept"
        ? "Booking request accepted"
        : "Booking request rejected",
    data: booking,
  });
});
