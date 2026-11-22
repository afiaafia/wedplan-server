import { getDatabase } from "./database.js";
import { COLLECTIONS } from "./collections.js";

export async function createDatabaseIndexes(): Promise<void> {
  const db = getDatabase();
  const users = db.collection("user");
  const roleMigration = await users.updateMany(
    {
      $or: [{ roles: { $exists: false } }, { roles: null }],
    },
    [
      {
        $set: {
          roles: {
            $switch: {
              branches: [
                { case: { $eq: ["$role", "admin"] }, then: ["admin"] },
                { case: { $eq: ["$role", "vendor"] }, then: ["vendor"] },
              ],
              default: ["customer"],
            },
          },
        },
      },
    ]
  );
  if (roleMigration.modifiedCount > 0) {
    console.log(`Migrated roles for ${roleMigration.modifiedCount} existing users`);
  }

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
      key: { vendorId: 1, isActive: 1 },
      name: "service_vendor_active",
    },
    {
      key: { title: "text" },
      name: "service_title_text",
    },
    {
      key: { approvalStatus: 1, createdAt: -1 },
      name: "service_moderation_queue",
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
    {
      key: { activeRequestKey: 1 },
      name: "booking_active_request_key_unique",
      unique: true,
      partialFilterExpression: { activeRequestKey: { $exists: true } },
    },
    {
      key: { vendorId: 1, createdAt: -1 },
      name: "booking_vendor_created",
    },
    {
      key: { status: 1, createdAt: -1 },
      name: "booking_status_created",
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
    {
      key: { status: 1, createdAt: -1 },
      name: "transaction_status_created",
    },
    {
      key: { stripeEventId: 1 },
      name: "transaction_stripe_event",
      sparse: true,
    },
  ]);

  await users.createIndexes([
    {
      key: { role: 1, createdAt: -1 },
      name: "user_role_created",
    },
    {
      key: { role: 1, subscriptionPlan: 1, subscriptionExpiresAt: 1 },
      name: "user_role_subscription",
    },
    {
      key: { isBlocked: 1, role: 1 },
      name: "user_blocked_role",
    },
    {
      key: { roles: 1, createdAt: -1 },
      name: "user_roles_created",
    },
    {
      key: { roles: 1, subscriptionPlan: 1, subscriptionExpiresAt: 1 },
      name: "user_roles_subscription",
    },
    {
      key: { isBlocked: 1, roles: 1 },
      name: "user_blocked_roles",
    },
  ]);

  await db.collection(COLLECTIONS.webhookEvents).createIndexes([
    {
      key: { eventId: 1 },
      name: "webhook_event_id",
      unique: true,
    },
  ]);

  console.log("Database indexes created successfully");
}
