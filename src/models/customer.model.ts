import { ObjectId, type Db, type Filter, type WithId } from "mongodb";
import { COLLECTIONS } from "../config/collections.js";
import { getDatabase } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { assertActiveCustomer } from "../services/customer-account.service.js";
import {
  BOOKING_STATUSES,
  type BookingDocument,
  type BookingStatus,
} from "../types/booking.js";
import {
  SERVICE_CATEGORIES,
  type ServiceCategory,
  type ServiceDocument,
} from "../types/service.js";
import type {
  CustomerBooking,
  CustomerBookingFilter,
  CustomerBookingPagination,
  CustomerBookingService,
  CustomerBookingVendor,
  CustomerDashboardData,
  CustomerDashboardStats,
  CustomerProfile,
} from "../types/customer.js";

const USER_COLLECTION = "user";

const BOOKING_PROJECTION = {
  _id: 1,
  serviceId: 1,
  vendorId: 1,
  eventDate: 1,
  eventLocation: 1,
  message: 1,
  status: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

const SERVICE_RELATION_PROJECTION = {
  _id: 1,
  title: 1,
  category: 1,
  price: 1,
  images: 1,
} as const;

const VENDOR_RELATION_PROJECTION = {
  _id: 1,
  name: 1,
  image: 1,
  businessName: 1,
} as const;

const PROFILE_PROJECTION = {
  _id: 1,
  name: 1,
  email: 1,
  image: 1,
  businessName: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

interface VendorRecord {
  name?: unknown;
  image?: unknown;
  businessName?: unknown;
}

interface CustomerProfileRecord {
  name?: unknown;
  email?: unknown;
  image?: unknown;
  businessName?: unknown;
  role?: unknown;
  isBlocked?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface BookingRelations {
  services: Map<string, WithId<ServiceDocument>>;
  vendors: Map<string, WithId<VendorRecord>>;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  return "";
}

function toServiceCategory(value: unknown): ServiceCategory | null {
  if (
    typeof value === "string" &&
    (SERVICE_CATEGORIES as readonly string[]).includes(value)
  ) {
    return value as ServiceCategory;
  }

  return null;
}

function toBookingStatus(value: unknown): BookingStatus {
  if (
    typeof value === "string" &&
    (BOOKING_STATUSES as readonly string[]).includes(value)
  ) {
    return value as BookingStatus;
  }

  return "Pending";
}

function validObjectIdStrings(values: readonly unknown[]): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && ObjectId.isValid(value)
      )
    )
  );
}

async function loadBookingRelations(
  bookings: readonly WithId<BookingDocument>[],
  db: Db
): Promise<BookingRelations> {
  const serviceIds = validObjectIdStrings(bookings.map((booking) => booking.serviceId));
  const vendorIds = validObjectIdStrings(bookings.map((booking) => booking.vendorId));

  const [services, vendors] = await Promise.all([
    serviceIds.length
      ? db
          .collection<ServiceDocument>(COLLECTIONS.services)
          .find(
            { _id: { $in: serviceIds.map((id) => new ObjectId(id)) } },
            { projection: SERVICE_RELATION_PROJECTION }
          )
          .toArray()
      : Promise.resolve([] as WithId<ServiceDocument>[]),
    vendorIds.length
      ? db
          .collection<VendorRecord>(USER_COLLECTION)
          .find(
            { _id: { $in: vendorIds.map((id) => new ObjectId(id)) } },
            { projection: VENDOR_RELATION_PROJECTION }
          )
          .toArray()
      : Promise.resolve([] as WithId<VendorRecord>[]),
  ]);

  return {
    services: new Map(services.map((service) => [service._id.toString(), service])),
    vendors: new Map(vendors.map((vendor) => [vendor._id.toString(), vendor])),
  };
}

function toCustomerBookingService(
  service: WithId<ServiceDocument> | undefined
): CustomerBookingService | null {
  if (!service) return null;

  const image = Array.isArray(service.images)
    ? service.images.find((item) => typeof item === "string" && item.trim()) || null
    : null;

  return {
    id: service._id.toString(),
    title: optionalText(service.title) || "Service listing unavailable",
    image,
    category: toServiceCategory(service.category),
    price:
      typeof service.price === "number" && Number.isFinite(service.price)
        ? service.price
        : null,
  };
}

function toCustomerBookingVendor(
  vendorId: string,
  vendor: WithId<VendorRecord> | undefined
): CustomerBookingVendor | null {
  if (!vendor) return null;

  return {
    id: vendorId,
    name: optionalText(vendor.name),
    businessName: optionalText(vendor.businessName),
    profileImage: optionalText(vendor.image),
  };
}

function toCustomerBooking(
  document: WithId<BookingDocument>,
  relations: BookingRelations
): CustomerBooking {
  const serviceId = typeof document.serviceId === "string" ? document.serviceId : "";
  const vendorId = typeof document.vendorId === "string" ? document.vendorId : "";

  return {
    id: document._id.toString(),
    serviceId,
    service: toCustomerBookingService(relations.services.get(serviceId)),
    vendorId,
    vendor: toCustomerBookingVendor(vendorId, relations.vendors.get(vendorId)),
    eventDate: toIsoDate(document.eventDate),
    eventLocation: optionalText(document.eventLocation) || "",
    message: typeof document.message === "string" ? document.message : "",
    status: toBookingStatus(document.status),
    createdAt: toIsoDate(document.createdAt),
    updatedAt: toIsoDate(document.updatedAt),
  };
}

function statusFilter(status: CustomerBookingFilter): Partial<Filter<BookingDocument>> {
  if (status === "all") return {};

  const statuses: Record<Exclude<CustomerBookingFilter, "all">, BookingStatus> = {
    pending: "Pending",
    accepted: "Accepted",
    rejected: "Rejected",
    cancelled: "Cancelled",
  };

  return { status: statuses[status] };
}

function customerBookingFilter(
  customerId: string,
  status: CustomerBookingFilter
): Filter<BookingDocument> {
  return { customerId, ...statusFilter(status) };
}

function toCustomerProfile(
  document: WithId<CustomerProfileRecord>
): CustomerProfile {
  return {
    id: document._id.toString(),
    name: optionalText(document.name) || "",
    email: optionalText(document.email) || "",
    image: optionalText(document.image),
    businessName: optionalText(document.businessName),
    createdAt: toIsoDate(document.createdAt),
    updatedAt: toIsoDate(document.updatedAt),
  };
}

export async function getCustomerDashboardStats(
  customerId: string,
  db: Db = getDatabase()
): Promise<CustomerDashboardStats> {
  await assertActiveCustomer(customerId, db);

  const collection = db.collection<BookingDocument>(COLLECTIONS.bookings);
  const [totalBookings, pendingBookings, acceptedBookings, rejectedBookings] =
    await Promise.all([
      collection.countDocuments({ customerId }),
      collection.countDocuments({ customerId, status: "Pending" }),
      collection.countDocuments({ customerId, status: "Accepted" }),
      collection.countDocuments({ customerId, status: "Rejected" }),
    ]);

  return { totalBookings, pendingBookings, acceptedBookings, rejectedBookings };
}

export async function findRecentCustomerBookings(
  customerId: string,
  limit: number,
  db: Db = getDatabase()
): Promise<CustomerBooking[]> {
  await assertActiveCustomer(customerId, db);

  const documents = await db
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .find({ customerId }, { projection: BOOKING_PROJECTION })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray();

  const relations = await loadBookingRelations(documents, db);
  return documents.map((document) => toCustomerBooking(document, relations));
}

export async function getCustomerDashboard(
  customerId: string,
  recentLimit: number,
  db: Db = getDatabase()
): Promise<CustomerDashboardData> {
  const [stats, bookings] = await Promise.all([
    getCustomerDashboardStats(customerId, db),
    findRecentCustomerBookings(customerId, recentLimit, db),
  ]);

  return { stats, bookings };
}

export async function findCustomerBookings(
  customerId: string,
  query: { status: CustomerBookingFilter; page: number; limit: number },
  db: Db = getDatabase()
): Promise<{ bookings: CustomerBooking[]; pagination: CustomerBookingPagination }> {
  await assertActiveCustomer(customerId, db);

  const filter = customerBookingFilter(customerId, query.status);
  const collection = db.collection<BookingDocument>(COLLECTIONS.bookings);

  const [documents, total] = await Promise.all([
    collection
      .find(filter, { projection: BOOKING_PROJECTION })
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  const relations = await loadBookingRelations(documents, db);
  const totalPages = Math.ceil(total / query.limit);

  return {
    bookings: documents.map((document) => toCustomerBooking(document, relations)),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };
}

export async function findCustomerBookingById(
  customerId: string,
  bookingId: string,
  db: Db = getDatabase()
): Promise<CustomerBooking | null> {
  await assertActiveCustomer(customerId, db);

  if (!ObjectId.isValid(bookingId)) return null;

  const document = await db
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .findOne(
      { _id: new ObjectId(bookingId), customerId },
      { projection: BOOKING_PROJECTION }
    );

  if (!document) return null;

  const relations = await loadBookingRelations([document], db);
  return toCustomerBooking(document, relations);
}

export async function cancelCustomerBooking(
  customerId: string,
  bookingId: string,
  db: Db = getDatabase()
): Promise<CustomerBooking> {
  await assertActiveCustomer(customerId, db);

  if (!ObjectId.isValid(bookingId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid booking id");
  }

  const objectId = new ObjectId(bookingId);
  const collection = db.collection<BookingDocument>(COLLECTIONS.bookings);
  const now = new Date();

  const result = await collection.updateOne(
    { _id: objectId, customerId, status: "Pending" },
    {
      $set: { status: "Cancelled", updatedAt: now },
      $unset: { activeRequestKey: "" },
    }
  );

  if (result.matchedCount === 0) {
    const existing = await collection.findOne(
      { _id: objectId, customerId },
      { projection: { status: 1 } }
    );

    if (!existing) {
      throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
    }

    throw new AppError(
      409,
      "BOOKING_NOT_CANCELLABLE",
      "Only pending bookings can be cancelled"
    );
  }

  const updated = await collection.findOne(
    { _id: objectId, customerId },
    { projection: BOOKING_PROJECTION }
  );

  if (!updated) {
    throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
  }

  const relations = await loadBookingRelations([updated], db);
  return toCustomerBooking(updated, relations);
}

export async function findCustomerProfile(
  customerId: string,
  db: Db = getDatabase()
): Promise<CustomerProfile> {
  await assertActiveCustomer(customerId, db);

  const document = await db
    .collection<CustomerProfileRecord>(USER_COLLECTION)
    .findOne(
      { _id: new ObjectId(customerId) },
      { projection: PROFILE_PROJECTION }
    );

  if (!document) {
    throw new AppError(401, "UNAUTHORIZED", "Your account no longer exists");
  }

  return toCustomerProfile(document);
}

export async function updateCustomerProfile(
  customerId: string,
  changes: { name?: string; image?: string },
  db: Db = getDatabase()
): Promise<CustomerProfile> {
  await assertActiveCustomer(customerId, db);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.image !== undefined) set.image = changes.image;

  const result = await db.collection<CustomerProfileRecord>(USER_COLLECTION).updateOne(
    {
      _id: new ObjectId(customerId),
      roles: "customer",
      isBlocked: { $ne: true },
    },
    { $set: set }
  );

  if (result.matchedCount === 0) {
    throw new AppError(401, "UNAUTHORIZED", "Your account no longer exists");
  }

  return findCustomerProfile(customerId, db);
}
