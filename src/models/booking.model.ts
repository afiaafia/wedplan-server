import { ObjectId, type Db, type Filter, type UpdateFilter, type WithId } from "mongodb";
import { getDatabase } from "../config/database.js";
import { COLLECTIONS } from "../config/collections.js";
import {
  ACTIVE_BOOKING_STATUSES,
  type BookingDocument,
  type BookingStatus,
} from "../types/booking.js";
import type { AdminBookingsQuery, VendorBookingsQuery } from "../validators/dashboard.validator.js";
import { buildPaginationMeta, type PaginationMeta } from "../types/dashboard.js";
import { AppError } from "../errors/app-error.js";

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

export interface ActiveBookingLookup {
  customerId: string;
  serviceId: string;
  eventDate: Date;
}

export async function hasActiveBooking(
  lookup: ActiveBookingLookup,
  db: Db = getDatabase()
): Promise<boolean> {
  const count = await db
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .countDocuments(
      {
        customerId: lookup.customerId,
        serviceId: lookup.serviceId,
        eventDate: lookup.eventDate,
        status: { $in: [...ACTIVE_BOOKING_STATUSES] },
      },
      { limit: 1 }
    );

  return count > 0;
}

export async function insertBooking(
  document: BookingDocument,
  db: Db = getDatabase()
): Promise<WithId<BookingDocument>> {
  const result = await db
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .insertOne(document);

  return { ...document, _id: result.insertedId };
}

export async function releaseActiveBookingKey(
  bookingId: string,
  db: Db = getDatabase()
): Promise<void> {
  if (!ObjectId.isValid(bookingId)) {
    return;
  }

  await db
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .updateOne(
      { _id: new ObjectId(bookingId) },
      { $unset: { activeRequestKey: "" } } as UpdateFilter<BookingDocument>
    );
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export interface BookingPerson {
  id: string;
  name?: string;
  image?: string;
  businessName?: string;
}

export interface VendorBookingView extends VendorBooking {
  serviceTitle: string;
  customer: BookingPerson | null;
  updatedAt: string;
}

export interface AdminBookingView extends VendorBookingView {
  vendor: BookingPerson | null;
}

interface BookingReferenceDocument {
  name?: unknown;
  image?: unknown;
  businessName?: unknown;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toBookingPerson(
  id: string | undefined,
  document: WithId<BookingReferenceDocument> | undefined
): BookingPerson | null {
  if (!id || !document) return null;

  return {
    id,
    ...(optionalText(document.name) ? { name: optionalText(document.name) } : {}),
    ...(optionalText(document.image)
      ? { image: optionalText(document.image) }
      : {}),
    ...(optionalText(document.businessName)
      ? { businessName: optionalText(document.businessName) }
      : {}),
  };
}

async function loadBookingReferences(
  bookings: ReadonlyArray<{ serviceId: string; customerId: string; vendorId?: string }>,
  db: Db
): Promise<{
  people: Map<string, WithId<BookingReferenceDocument>>;
  services: Map<string, string>;
}> {
  const peopleIds = Array.from(
    new Set(
      bookings
        .flatMap((booking) => [booking.customerId, booking.vendorId])
        .filter((id): id is string => typeof id === "string" && ObjectId.isValid(id))
    )
  ).map((id) => new ObjectId(id));
  const serviceIds = Array.from(
    new Set(bookings.map((booking) => booking.serviceId))
  ).filter((id) => ObjectId.isValid(id));

  const [people, serviceDocuments] = await Promise.all([
    peopleIds.length
      ? db
          .collection<BookingReferenceDocument>("user")
          .find(
            { _id: { $in: peopleIds } },
            { projection: { name: 1, image: 1, businessName: 1 } }
          )
          .toArray()
      : Promise.resolve([]),
    serviceIds.length
      ? db
          .collection<{ title: string }>(COLLECTIONS.services)
          .find({ _id: { $in: serviceIds.map((id) => new ObjectId(id)) } }, { projection: { title: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);

  return {
    people: new Map(people.map((person) => [person._id.toString(), person])),
    services: new Map(
      serviceDocuments.map((service) => [service._id.toString(), service.title])
    ),
  };
}

function toBookingView(
  document: BookingDocument & { _id: unknown },
  references: Awaited<ReturnType<typeof loadBookingReferences>>,
  includeVendor = false
): VendorBookingView | AdminBookingView {
  const base = toVendorBooking(document);
  const customer = toBookingPerson(
    document.customerId,
    references.people.get(document.customerId)
  );
  const view: VendorBookingView = {
    ...base,
    serviceTitle: references.services.get(document.serviceId) ?? "Service unavailable",
    customer,
    updatedAt: document.updatedAt.toISOString(),
  };

  if (!includeVendor) return view;

  return {
    ...view,
    vendor: toBookingPerson(document.vendorId, references.people.get(document.vendorId)),
  };
}

function buildVendorBookingFilter(
  vendorId: string,
  query: VendorBookingsQuery | AdminBookingsQuery
): Filter<BookingDocument> {
  const filter: Filter<BookingDocument> = {};

  if ("vendorId" in query && query.vendorId) {
    filter.vendorId = query.vendorId;
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.serviceId) {
    filter.serviceId = query.serviceId;
  }

  if ("customerId" in query && query.customerId) {
    filter.customerId = query.customerId;
  }

  return filter;
}

export async function findVendorBookings(
  vendorId: string,
  query: VendorBookingsQuery,
  db: Db = getDatabase()
): Promise<{ bookings: VendorBookingView[]; meta: PaginationMeta }> {
  const collection = db.collection<BookingDocument>(COLLECTIONS.bookings);
  const filter = { ...buildVendorBookingFilter(vendorId, query), vendorId };

  const [documents, total] = await Promise.all([
    collection
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  const references = await loadBookingReferences(documents, db);

  return {
    bookings: documents.map((document) => toBookingView(document, references)),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function countVendorBookingsByStatus(
  vendorId: string,
  status: BookingStatus,
  db: Db = getDatabase()
): Promise<number> {
  return db
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .countDocuments({ vendorId, status });
}

export async function findBookingForVendor(
  vendorId: string,
  id: string,
  db: Db = getDatabase()
): Promise<VendorBookingView | null> {
  if (!ObjectId.isValid(id)) return null;

  const document = await db
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .findOne({ _id: new ObjectId(id), vendorId });

  if (!document) return null;

  const references = await loadBookingReferences([document], db);
  return toBookingView(document, references);
}

export async function updateVendorBookingStatus(
  vendorId: string,
  id: string,
  action: "accept" | "reject",
  db: Db = getDatabase()
): Promise<VendorBookingView> {
  if (!ObjectId.isValid(id)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid booking id");
  }

  const collection = db.collection<BookingDocument>(COLLECTIONS.bookings);
  const existing = await collection.findOne({ _id: new ObjectId(id), vendorId });

  if (!existing) {
    throw new AppError(404, "BOOKING_NOT_FOUND", "Booking request not found");
  }

  if (existing.status !== "Pending") {
    throw new AppError(
      409,
      "BOOKING_ALREADY_PROCESSED",
      "Only pending booking requests can be accepted or rejected"
    );
  }

  const update: UpdateFilter<BookingDocument> = {
    $set: {
      status: action === "accept" ? "Accepted" : "Rejected",
      updatedAt: new Date(),
    },
  };

  if (action === "reject") {
    (update as { $unset?: Record<string, string> }).$unset = {
      activeRequestKey: "",
    };
  }

  const updated = await collection.findOneAndUpdate(
    { _id: new ObjectId(id), vendorId, status: "Pending" },
    update,
    { returnDocument: "after" }
  );

  if (!updated) {
    throw new AppError(
      409,
      "BOOKING_ALREADY_PROCESSED",
      "This booking request was already processed"
    );
  }

  const references = await loadBookingReferences([updated], db);
  return toBookingView(updated, references);
}

export async function findAdminBookings(
  query: AdminBookingsQuery,
  db: Db = getDatabase()
): Promise<{ bookings: AdminBookingView[]; meta: PaginationMeta }> {
  const collection = db.collection<BookingDocument>(COLLECTIONS.bookings);
  const filter = buildVendorBookingFilter("", query);
  const keyword = query.q?.trim();

  if (keyword) {
    const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const matchingServiceIds = await db
      .collection<{ title: string }>(COLLECTIONS.services)
      .find({ title: { $regex: pattern } }, { projection: { title: 1 } })
      .toArray();
    const matchingPeople = await db
      .collection<BookingReferenceDocument>("user")
      .find({ name: { $regex: pattern } }, { projection: { name: 1 } })
      .toArray();

    filter.$or = [
      { eventLocation: { $regex: pattern } },
      { message: { $regex: pattern } },
      {
        serviceId: {
          $in: matchingServiceIds.map((service) => service._id.toString()),
        },
      },
      {
        customerId: { $in: matchingPeople.map((person) => person._id.toString()) },
      },
      {
        vendorId: { $in: matchingPeople.map((person) => person._id.toString()) },
      },
    ];
  }

  const [documents, total] = await Promise.all([
    collection
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  const references = await loadBookingReferences(documents, db);

  return {
    bookings: documents.map((document) =>
      toBookingView(document, references, true) as AdminBookingView
    ),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function findAdminBookingById(
  id: string,
  db: Db = getDatabase()
): Promise<AdminBookingView | null> {
  if (!ObjectId.isValid(id)) return null;

  const document = await db
    .collection<BookingDocument>(COLLECTIONS.bookings)
    .findOne({ _id: new ObjectId(id) });

  if (!document) return null;

  const references = await loadBookingReferences([document], db);
  return toBookingView(document, references, true) as AdminBookingView;
}
