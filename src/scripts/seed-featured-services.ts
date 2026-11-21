import "dotenv/config";
import { ObjectId, type Db } from "mongodb";
import { COLLECTIONS } from "../config/collections.js";
import { connectDatabase, getDatabase, getMongoClient } from "../config/database.js";
import type { ServiceCategory, ServiceDocument } from "../types/service.js";
import { createServiceSchema } from "../validators/service.validator.js";

interface SeedService {
  title: string;
  category: ServiceCategory;
  description: string;
  location: string;
  price: number;
  images: string[];
  createdAt: string;
}

const SEED_SERVICES: SeedService[] = [
  {
    title: "Lagos Garden Wedding Photography",
    category: "Photography",
    description:
      "Full-day documentary photography for your ceremony and reception, including a pre-wedding consultation, two photographers, and a curated online gallery within two weeks.",
    location: "Lagos",
    price: 450000,
    images: ["https://i.ibb.co/4Z6K6k6R/wedplan-photography.jpg"],
    createdAt: "2026-11-20T09:00:00.000Z",
  },
  {
    title: "Sunset Ceremony Videography Package",
    category: "Videography",
    description:
      "Cinematic highlight film and full ceremony coverage with drone footage, professional audio, and a private download link for sharing with family.",
    location: "Lagos",
    price: 380000,
    images: ["https://i.ibb.co/1f9G6gN1/wedplan-videography.jpg"],
    createdAt: "2026-11-19T09:00:00.000Z",
  },
  {
    title: "Eko Gardens Wedding Venue",
    category: "Wedding Venue",
    description:
      "An elegant open-air garden venue for up to 250 guests with garden arches, bridal suite, on-site parking, and a dedicated event coordinator.",
    location: "Lagos",
    price: 950000,
    images: ["https://i.ibb.co/WWWv51vW/wedplan-venue.jpg"],
    createdAt: "2026-11-18T09:00:00.000Z",
  },
  {
    title: "Contemporary Wedding Catering",
    category: "Catering",
    description:
      "Customized wedding menu with Nigerian and continental dishes, chafing dishes, service staff, and a tasting session for the couple.",
    location: "Abuja",
    price: 750000,
    images: ["https://i.ibb.co/Z1Kw82b1/wedplan-catering.jpg"],
    createdAt: "2026-11-17T09:00:00.000Z",
  },
  {
    title: "Floral & Decor Styling",
    category: "Decoration",
    description:
      "Full reception styling with fresh floral arrangements, table linens, candlelight, and a custom backdrop designed around your colour palette.",
    location: "Port Harcourt",
    price: 320000,
    images: ["https://i.ibb.co/RGSVbZtx/wedplan-decoration.jpg"],
    createdAt: "2026-11-16T09:00:00.000Z",
  },
  {
    title: "Bridal Makeup & Beauty",
    category: "Makeup & Beauty",
    description:
      "Bridal and bridesmaid makeup with skin prep, hair styling, trial session, and a touch-up kit for the big day.",
    location: "Ibadan",
    price: 180000,
    images: ["https://i.ibb.co/9k6nXxxQ/wedplan-makeup.jpg"],
    createdAt: "2026-11-15T09:00:00.000Z",
  },
];

async function loadActiveVendorIds(db: Db): Promise<string[]> {
  const vendors = await db
    .collection<{ role?: string; isBlocked?: boolean }>("user")
    .find(
      { role: "vendor", isBlocked: { $ne: true } },
      { projection: { _id: 1 } }
    )
    .toArray();

  return vendors
    .map((vendor) => vendor._id.toHexString())
    .filter((vendorId) => ObjectId.isValid(vendorId));
}

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_PRODUCTION_FEATURED_SEED !== "true"
  ) {
    throw new Error(
      "Refusing to seed production data. Use a development environment or set ALLOW_PRODUCTION_FEATURED_SEED=true explicitly."
    );
  }

  await connectDatabase();

  try {
    const db = getDatabase();
    const vendorIds = await loadActiveVendorIds(db);

    if (vendorIds.length === 0) {
      throw new Error(
        "No active vendor accounts found. Seed aborted before inserting services."
      );
    }

    const collection = db.collection<ServiceDocument>(COLLECTIONS.services);
    const usedVendorIds = new Set<string>();
    let inserted = 0;
    let skipped = 0;

    for (const [index, seed] of SEED_SERVICES.entries()) {
      const vendorId = vendorIds[index % vendorIds.length];
      const input = createServiceSchema.parse({
        title: seed.title,
        category: seed.category,
        description: seed.description,
        location: seed.location,
        price: seed.price,
        images: seed.images,
        isActive: true,
      });
      const createdAt = new Date(seed.createdAt);
      const document: ServiceDocument = {
        vendorId,
        ...input,
        approvalStatus: "approved",
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      };

      const result = await collection.updateOne(
        { vendorId, title: seed.title },
        {
          $setOnInsert: { createdAt: document.createdAt },
          $set: {
            category: document.category,
            description: document.description,
            location: document.location,
            price: document.price,
            images: document.images,
            approvalStatus: document.approvalStatus,
            isActive: document.isActive,
            updatedAt: document.updatedAt,
          },
        },
        { upsert: true }
      );

      usedVendorIds.add(vendorId);
      if (result.upsertedCount > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    }

    console.log(
      `Featured services seed complete: ${inserted} inserted, ${skipped} skipped`
    );
    console.log(`Active vendor accounts found: ${vendorIds.length}`);
    console.log(`Vendors assigned seed services: ${usedVendorIds.size}`);
  } finally {
    await getMongoClient().close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Featured services seed failed: ${message}`);
  process.exitCode = 1;
});
