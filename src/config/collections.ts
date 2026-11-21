import { getDatabase } from "./database.js";

export const COLLECTIONS = {
  services: "services",
  bookings: "bookings",
  transactions: "transactions",
  webhookEvents: "webhookEvents",
  serviceLimitCounters: "serviceLimitCounters",
} as const;

export async function createCollections(): Promise<void> {
  const db = getDatabase();
  const existingCollections = await db
    .listCollections()
    .toArray();

  const existingNames = new Set(
    existingCollections.map((collection) => collection.name)
  );

  for (const name of Object.values(COLLECTIONS)) {
    if (!existingNames.has(name)) {
      await db.createCollection(name);
      console.log(`Created collection: ${name}`);
    } else {
      console.log(`Collection already exists: ${name}`);
    }
  }
}
