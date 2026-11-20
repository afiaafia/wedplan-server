import { getDatabase } from "./database.js";
import { COLLECTIONS } from "./collections.js";

export async function createDatabaseIndexes(): Promise<void> {
  const db = getDatabase();

  // Service indexes
  await db.collection(COLLECTIONS.services).createIndexes([
    {
      key: { approvalStatus: 1, isActive: 1, category: 1, location: 1 },
      name: "service_browse_filters",
    },
    {
      key: { approvalStatus: 1, isActive: 1, price: 1 },
      name: "service_price_sort",
    },
    {
      key: { approvalStatus: 1, isActive: 1, createdAt: -1 },
      name: "service_public_newest",
    },
    {
      key: { vendorId: 1, createdAt: -1 },
      name: "service_vendor_created",
    },
    {
      key: { title: "text" },
      name: "service_title_text",
    },
  ]);

  // Booking indexes
  await db.collection(COLLECTIONS.bookings).createIndexes([
    {
      key: { customerId: 1, createdAt: -1 },
      name: "booking_customer_history",
    },
    {
      key: { vendorId: 1, status: 1, createdAt: -1 },
      name: "booking_vendor_status",
    },
    {
      key: { serviceId: 1, eventDate: 1, status: 1 },
      name: "booking_service_event_date",
    },
  ]);

  // Transaction indexes
  await db.collection(COLLECTIONS.transactions).createIndexes([
    {
      key: { vendorId: 1, createdAt: -1 },
      name: "transaction_vendor_history",
    },
    {
      key: { stripeSessionId: 1 },
      name: "transaction_stripe_session",
      unique: true,
    },
    {
      key: { stripeSubscriptionId: 1 },
      name: "transaction_stripe_subscription",
      unique: true,
      sparse: true,
    },
  ]);

  console.log("Database indexes created successfully");
}
