import { asyncHandler } from "../middleware/async-handler.js";
import { findRecentVendorBookings } from "../models/booking.model.js";
import { getVendorDashboardSummary } from "../models/dashboard.model.js";
import { findVendorServices } from "../models/service.model.js";

export const getVendorDashboard = asyncHandler(async (_req, res) => {
  const vendorId = res.locals.vendor.id;

  const [stats, services, bookings] = await Promise.all([
    getVendorDashboardSummary(vendorId),
    findVendorServices(vendorId),
    findRecentVendorBookings(vendorId),
  ]);

  res.status(200).json({
    success: true,
    data: {
      stats,
      services,
      bookings,
    },
  });
});
