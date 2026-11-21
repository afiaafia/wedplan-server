import {
  ObjectId,
  type ClientSession,
  type Db,
  type Filter,
  type Sort,
  type UpdateFilter,
  type WithId,
} from "mongodb";
import { COLLECTIONS } from "../config/collections.js";
import { getDatabase } from "../config/database.js";
import type {
  FeaturedService,
  FeaturedServicesData,
  FeaturedVendor,
  PublicService,
  PublicServiceSort,
  ServiceCategory,
  ServiceDocument,
  VendorService,
  VendorServiceInput,
  VendorServiceUpdate,
} from "../types/service.js";
import type { PublicServicesQuery } from "../validators/service.validator.js";

const PUBLIC_SERVICE_PROJECTION = {
  _id: 1,
  title: 1,
  category: 1,
  description: 1,
  location: 1,
  price: 1,
  images: 1,
  createdAt: 1,
} as const;

const PUBLIC_SERVICE_SORTS: Record<PublicServiceSort, Sort> = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: -1 },
};

const USER_COLLECTION = "user";

const FEATURED_SERVICE_PROJECTION = {
  ...PUBLIC_SERVICE_PROJECTION,
  vendorId: 1,
  approvalStatus: 1,
  isActive: 1,
} as const;

const FEATURED_SERVICE_SORT: Sort = { createdAt: -1, _id: -1 };

const FEATURED_VENDOR_PROJECTION = {
  _id: 1,
  name: 1,
  image: 1,
  businessName: 1,
} as const;

interface FeaturedVendorDocument {
  name?: unknown;
  image?: unknown;
  businessName?: unknown;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPublicFilter(query: PublicServicesQuery): Filter<ServiceDocument> {
  const filter: Filter<ServiceDocument> = {
    approvalStatus: "approved",
    isActive: true,
  };

  const keyword = query.q?.trim();
  if (keyword) {
    const pattern = escapeRegex(keyword);
    filter.$or = [
      { title: { $regex: pattern, $options: "i" } },
      { description: { $regex: pattern, $options: "i" } },
      { category: { $regex: pattern, $options: "i" } },
      { location: { $regex: pattern, $options: "i" } },
    ];
  }

  if (query.category?.length) {
    filter.category = { $in: query.category as ServiceCategory[] };
  }

  const location = query.location?.trim();
  if (location) {
    filter.location = { $regex: escapeRegex(location), $options: "i" };
  }

  return filter;
}

function toPublicService(document: WithId<ServiceDocument>): PublicService {
  return {
    id: document._id.toString(),
    title: document.title,
    category: document.category,
    description: document.description,
    location: document.location,
    price: document.price,
    images: Array.isArray(document.images) ? document.images : [],
    createdAt: document.createdAt.toISOString(),
  };
}

export async function findPublicServices(
  query: PublicServicesQuery
): Promise<{ services: PublicService[]; total: number }> {
  const collection = getDatabase().collection<ServiceDocument>(
    COLLECTIONS.services
  );
  const filter = buildPublicFilter(query);

  const [documents, total] = await Promise.all([
    collection
      .find(filter, { projection: PUBLIC_SERVICE_PROJECTION })
      .sort(PUBLIC_SERVICE_SORTS[query.sort])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return { services: documents.map(toPublicService), total };
}

export async function findPublicServiceById(
  id: string
): Promise<PublicService | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const document = await getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOne(
      {
        _id: new ObjectId(id),
        approvalStatus: "approved",
        isActive: true,
      },
      { projection: PUBLIC_SERVICE_PROJECTION }
    );

  return document ? toPublicService(document) : null;
}

export function buildFeaturedFilter(): Filter<ServiceDocument> {
  return {
    approvalStatus: "approved",
    isActive: true,
  };
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function toFeaturedVendor(
  document: WithId<FeaturedVendorDocument>
): FeaturedVendor {
  const name = optionalText(document.name);
  const profileImage = optionalText(document.image);
  const businessName = optionalText(document.businessName);

  return {
    id: document._id.toString(),
    ...(name ? { name } : {}),
    ...(profileImage ? { profileImage } : {}),
    ...(businessName ? { businessName } : {}),
  };
}

export function mapFeaturedServices(
  documents: WithId<ServiceDocument>[],
  vendorDocuments: WithId<FeaturedVendorDocument>[]
): FeaturedService[] {
  const vendorsById = new Map(
    vendorDocuments.map((vendor) => [vendor._id.toString(), vendor])
  );

  return documents.map((document) => {
    const vendor = vendorsById.get(document.vendorId);

    return {
      ...toPublicService(document),
      isActive: document.isActive,
      approvalStatus: "approved",
      vendor: vendor ? toFeaturedVendor(vendor) : null,
    };
  });
}

export async function findFeaturedServices(
  limit: number,
  db: Db = getDatabase()
): Promise<FeaturedServicesData> {
  const filter = buildFeaturedFilter();
  const servicesCollection = db.collection<ServiceDocument>(COLLECTIONS.services);

  const [documents, total] = await Promise.all([
    servicesCollection
      .find(filter, { projection: FEATURED_SERVICE_PROJECTION })
      .sort(FEATURED_SERVICE_SORT)
      .limit(limit)
      .toArray(),
    servicesCollection.countDocuments(filter),
  ]);

  const vendorObjectIds = Array.from(
    new Set(
      documents
        .map((document) => document.vendorId)
        .filter(
          (vendorId): vendorId is string =>
            typeof vendorId === "string" && ObjectId.isValid(vendorId)
        )
    )
  ).map((vendorId) => new ObjectId(vendorId));

  const vendorDocuments = vendorObjectIds.length
    ? await db
        .collection<FeaturedVendorDocument>(USER_COLLECTION)
        .find(
          { _id: { $in: vendorObjectIds } },
          { projection: FEATURED_VENDOR_PROJECTION }
        )
        .toArray()
    : [];

  return {
    services: mapFeaturedServices(documents, vendorDocuments),
    total,
  };
}

function toVendorService(document: WithId<ServiceDocument>): VendorService {
  return {
    ...toPublicService(document),
    approvalStatus: document.approvalStatus,
    isActive: document.isActive,
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function buildVendorServiceFilter(
  vendorId: string,
  id: string
): Filter<ServiceDocument> {
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid service id");
  }

  return {
    _id: new ObjectId(id),
    vendorId,
  };
}

export async function countActiveVendorServices(
  vendorId: string,
  session?: ClientSession
): Promise<number> {
  return getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .countDocuments({ vendorId, isActive: true }, { session });
}

export async function countVendorServices(
  vendorId: string
): Promise<number> {
  return getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .countDocuments({ vendorId });
}

export async function countVendorServicesPendingApproval(
  vendorId: string
): Promise<number> {
  return getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .countDocuments({ vendorId, approvalStatus: "pending" });
}

export async function createVendorService(
  vendorId: string,
  input: VendorServiceInput,
  session?: ClientSession
): Promise<VendorService> {
  const now = new Date();
  const document: ServiceDocument = {
    vendorId,
    title: input.title,
    category: input.category,
    description: input.description,
    location: input.location,
    price: input.price,
    images: input.images,
    approvalStatus: "pending",
    isActive: input.isActive,
    createdAt: now,
    updatedAt: now,
  };

  const result = await getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .insertOne(document, { session });

  return toVendorService({ ...document, _id: result.insertedId });
}

export async function findVendorServices(
  vendorId: string
): Promise<VendorService[]> {
  const documents = await getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .find({ vendorId })
    .sort({ createdAt: -1, _id: -1 })
    .toArray();

  return documents.map(toVendorService);
}

export async function findVendorServiceById(
  vendorId: string,
  id: string,
  session?: ClientSession
): Promise<VendorService | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const document = await getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOne(buildVendorServiceFilter(vendorId, id), { session });

  return document ? toVendorService(document) : null;
}

export async function updateVendorService(
  vendorId: string,
  id: string,
  patch: VendorServiceUpdate,
  session?: ClientSession
): Promise<VendorService | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const changes = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as UpdateFilter<ServiceDocument>["$set"];

  const document = await getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOneAndUpdate(
      buildVendorServiceFilter(vendorId, id),
      { $set: { ...changes, updatedAt: new Date() } },
      { session, returnDocument: "after" }
    );

  return document ? toVendorService(document) : null;
}

export async function setVendorServiceActive(
  vendorId: string,
  id: string,
  isActive: boolean,
  session?: ClientSession,
  expectedIsActive?: boolean
): Promise<VendorService | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const filter = buildVendorServiceFilter(vendorId, id);
  if (expectedIsActive !== undefined) {
    filter.isActive = expectedIsActive;
  }

  const document = await getDatabase()
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOneAndUpdate(
      filter,
      { $set: { isActive, updatedAt: new Date() } },
      { session, returnDocument: "after" }
    );

  return document ? toVendorService(document) : null;
}
