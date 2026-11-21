import { getDatabase } from "../config/database.js";
import { COLLECTIONS } from "../config/collections.js";
import type { BookingDocument } from "../types/booking.js";

export interface VendorBooking {
  id: string;
  serviceId: string;
  customerId: string;
  eventDate: string;
  eventLocation: string;
  message: string;
  status: BookingDocument["status"];
  createdAt: string;
}

function toVendorBooking(document: BookingDocument & { _id: unknown }): VendorBooking {
  return {
    id: String(document._id),
    serviceId: document.serviceId,
    customerId: document.customerId,
    eventDate: document.eventDate.toISOString(),
    eventLocation: document.eventLocation,
    message: document.message,
    status: document.status,
    createdAt: document.createdAt.toISOString(),
  };
}

export async function countVendorBookings(vendorId: string): Promise<number> {
  return getDatabase()
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .countDocuments({ vendorId });
}

export async function findRecentVendorBookings(
  vendorId: string,
  limit = 10
): Promise<VendorBooking[]> {
  const documents = await getDatabase()
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .find({ vendorId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray();

  return documents.map(toVendorBooking);
}
