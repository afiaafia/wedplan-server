import { type Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import {
  hasActiveBooking,
  insertBooking,
  isDuplicateKeyError,
} from "../models/booking.model.js";
import { assertActiveCustomer } from "./customer-account.service.js";
import { findBookableServiceById } from "../models/service.model.js";
import type {
  BookingCreationResult,
  BookingDocument,
} from "../types/booking.js";
import type { CreateBookingBody } from "../validators/booking.validator.js";

function toBookingCreationResult(
  document: BookingDocument & { _id: unknown },
  serviceTitle: string
): BookingCreationResult {
  return {
    id: String(document._id),
    serviceId: document.serviceId,
    serviceTitle,
    vendorId: document.vendorId,
    eventDate: document.eventDate.toISOString(),
    eventLocation: document.eventLocation,
    message: document.message,
    status: document.status,
    createdAt: document.createdAt.toISOString(),
  };
}

export async function createBookingRequest(
  customerId: string,
  input: CreateBookingBody,
  db: Db = getDatabase()
): Promise<BookingCreationResult> {
  await assertActiveCustomer(customerId, db);

  const service = await findBookableServiceById(input.serviceId, db);
  if (!service) {
    throw new AppError(
      404,
      "SERVICE_NOT_FOUND",
      "This service is not available for booking"
    );
  }

  if (service.vendorId === customerId) {
    throw new AppError(
      403,
      "CANNOT_BOOK_OWN_SERVICE",
      "You cannot book your own service"
    );
  }

  const duplicate = await hasActiveBooking(
    {
      customerId,
      serviceId: service.id,
      eventDate: input.eventDate,
    },
    db
  );

  if (duplicate) {
    throw new AppError(
      409,
      "DUPLICATE_BOOKING",
      "You already have an active request for this service on that date"
    );
  }

  const now = new Date();
  const document: BookingDocument = {
    serviceId: service.id,
    vendorId: service.vendorId,
    customerId,
    eventDate: input.eventDate,
    eventLocation: input.eventLocation,
    message: input.message,
    status: "Pending",
    activeRequestKey: `${customerId}|${service.id}|${input.eventDate.toISOString()}`,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const inserted = await insertBooking(document, db);
    return toBookingCreationResult(inserted, service.title);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(
        409,
        "DUPLICATE_BOOKING",
        "You already have an active request for this service on that date"
      );
    }

    throw error;
  }
}
