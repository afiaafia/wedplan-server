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
  BrowseService,
  FeaturedService,
  FeaturedServicesData,
  FeaturedVendor,
  AdminService,
  PublicService,
  PublicServiceSort,
  ServiceDetail,
  ServiceApprovalStatus,
  ServiceCategory,
  ServiceDocument,
  ServiceDetailVendor,
  VendorService,
  VendorServiceInput,
  VendorServiceUpdate,
} from "../types/service.js";
import type { BookableServiceRecord } from "../types/booking.js";
import type {
  PublicServicesQuery,
  VendorServicesQuery,
} from "../validators/service.validator.js";
import type { AdminServicesQuery } from "../validators/dashboard.validator.js";
import {
  buildPaginationMeta,
  type PaginationMeta,
} from "../types/dashboard.js";

const PUBLIC_SERVICE_PROJECTION = {
  _id: 1,
  title: 1,
  category: 1,
  description: 1,
  location: 1,
  price: 1,
  images: 1,
  createdAt: 1,
  vendorId: 1,
} as const;

const PUBLIC_SERVICE_SORTS: Record<PublicServiceSort, Sort> = {
  recommended: { createdAt: -1, _id: -1 },
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

const SERVICE_DETAIL_PROJECTION = {
  ...PUBLIC_SERVICE_PROJECTION,
  vendorId: 1,
} as const;

const BOOKABLE_SERVICE_PROJECTION = {
  _id: 1,
  title: 1,
  vendorId: 1,
} as const;

interface FeaturedVendorDocument {
  name?: unknown;
  image?: unknown;
  businessName?: unknown;
}

interface AdminVendorDocument {
  name?: unknown;
  email?: unknown;
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
    price: Number.isFinite(document.price) ? document.price : 0,
    images: Array.isArray(document.images) ? document.images : [],
    createdAt: document.createdAt.toISOString(),
  };
}

async function findVendorDocuments(
  documents: readonly WithId<ServiceDocument>[],
  db: Db
): Promise<WithId<FeaturedVendorDocument>[]> {
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

  if (!vendorObjectIds.length) {
    return [];
  }

  return db
    .collection<FeaturedVendorDocument>(USER_COLLECTION)
    .find(
      { _id: { $in: vendorObjectIds } },
      { projection: FEATURED_VENDOR_PROJECTION }
    )
    .toArray();
}

function vendorForService(
  vendorId: unknown,
  vendorsById: Map<string, WithId<FeaturedVendorDocument>>
): ServiceDetailVendor | null {
  if (typeof vendorId !== "string") {
    return null;
  }

  const vendor = vendorsById.get(vendorId);
  return vendor ? toFeaturedVendor(vendor) : null;
}

export async function findPublicServices(
  query: PublicServicesQuery,
  db: Db = getDatabase()
): Promise<{ services: BrowseService[]; total: number }> {
  const collection = db.collection<ServiceDocument>(COLLECTIONS.services);
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

  const vendorDocuments = await findVendorDocuments(documents, db);
  const vendorsById = new Map(
    vendorDocuments.map((vendor) => [vendor._id.toString(), vendor])
  );

  return {
    services: documents.map((document) => ({
      ...toPublicService(document),
      vendor: vendorForService(document.vendorId, vendorsById),
    })),
    total,
  };
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

export async function findServiceDetailById(
  id: string,
  db: Db = getDatabase()
): Promise<ServiceDetail | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const document = await db
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOne(
      {
        _id: new ObjectId(id),
        approvalStatus: "approved",
        isActive: true,
      },
      { projection: SERVICE_DETAIL_PROJECTION }
    );

  if (!document) {
    return null;
  }

  const vendorObjectId =
    typeof document.vendorId === "string" && ObjectId.isValid(document.vendorId)
      ? new ObjectId(document.vendorId)
      : null;

  const vendorDocument = vendorObjectId
    ? await db
        .collection<FeaturedVendorDocument>(USER_COLLECTION)
        .findOne(
          { _id: vendorObjectId },
          { projection: FEATURED_VENDOR_PROJECTION }
        )
    : null;

  return {
    ...toPublicService(document),
    vendor: vendorDocument ? toFeaturedVendor(vendorDocument) : null,
  };
}

export async function findBookableServiceById(
  id: string,
  db: Db = getDatabase()
): Promise<BookableServiceRecord | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const document = await db
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOne(
      {
        _id: new ObjectId(id),
        approvalStatus: "approved",
        isActive: true,
      },
      { projection: BOOKABLE_SERVICE_PROJECTION }
    );

  if (!document) {
    return null;
  }

  return {
    id: document._id.toString(),
    title: document.title,
    vendorId: document.vendorId,
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

  const vendorDocuments = await findVendorDocuments(documents, db);

  return {
    services: mapFeaturedServices(documents, vendorDocuments),
    total,
  };
}

function toVendorService(document: WithId<ServiceDocument>): VendorService {
  const service: VendorService = {
    ...toPublicService(document),
    approvalStatus: document.approvalStatus,
    isActive: document.isActive,
    updatedAt: document.updatedAt.toISOString(),
  };

  if (typeof document.rejectionReason === "string" && document.rejectionReason) {
    service.rejectionReason = document.rejectionReason;
  }

  return service;
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
  session?: ClientSession,
  db: Db = getDatabase()
): Promise<number> {
  return db
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

export async function findServiceVendorId(
  id: string,
  db: Db = getDatabase()
): Promise<string | null> {
  if (!ObjectId.isValid(id)) return null;

  const document = await db
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOne({ _id: new ObjectId(id) }, { projection: { vendorId: 1 } });

  return typeof document?.vendorId === "string" ? document.vendorId : null;
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

export async function findServicesForReview(
  db: Db = getDatabase()
): Promise<VendorService[]> {
  const documents = await db
    .collection<ServiceDocument>(COLLECTIONS.services)
    .find({})
    .sort({ createdAt: -1, _id: -1 })
    .toArray();

  return documents.map(toVendorService);
}

export async function setServiceApprovalStatus(
  id: string,
  approvalStatus: ServiceApprovalStatus,
  db: Db = getDatabase(),
  rejectionReason?: string,
  expectedStatus?: ServiceApprovalStatus
): Promise<VendorService | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const filter: Filter<ServiceDocument> = { _id: new ObjectId(id) };
  if (expectedStatus) {
    filter.approvalStatus = expectedStatus;
  }

  const set: Record<string, unknown> = {
    approvalStatus,
    updatedAt: new Date(),
  };
  const update: UpdateFilter<ServiceDocument> = {
    $set: set as UpdateFilter<ServiceDocument>["$set"],
  };

  if (approvalStatus === "rejected" && rejectionReason) {
    set.rejectionReason = rejectionReason;
  } else {
    (update as { $unset?: Record<string, string> }).$unset = {
      rejectionReason: "",
    };
  }

  const document = await db
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOneAndUpdate(filter, update, { returnDocument: "after" });

  return document ? toVendorService(document) : null;
}

function buildManagedServiceFilter(
  query: VendorServicesQuery | AdminServicesQuery,
  vendorId?: string
): Filter<ServiceDocument> {
  const filter: Filter<ServiceDocument> = {};

  if (vendorId) {
    filter.vendorId = vendorId;
  }

  const keyword = query.q?.trim();
  if (keyword) {
    const pattern = escapeRegex(keyword);
    filter.$or = [
      { title: { $regex: pattern, $options: "i" } },
      { description: { $regex: pattern, $options: "i" } },
      { location: { $regex: pattern, $options: "i" } },
    ];
  }

  if (query.category) {
    filter.category = query.category;
  }

  if (query.approvalStatus) {
    filter.approvalStatus = query.approvalStatus;
  }

  if (query.isActive !== "all") {
    filter.isActive = query.isActive === "true";
  }

  return filter;
}

export async function findVendorServicesPage(
  vendorId: string,
  query: VendorServicesQuery,
  db: Db = getDatabase()
): Promise<{ services: VendorService[]; meta: PaginationMeta }> {
  const collection = db.collection<ServiceDocument>(COLLECTIONS.services);
  const filter = buildManagedServiceFilter(query, vendorId);
  const [documents, total] = await Promise.all([
    collection
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return {
    services: documents.map(toVendorService),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function findServicesForReviewPage(
  query: AdminServicesQuery,
  db: Db = getDatabase()
): Promise<{ services: AdminService[]; meta: PaginationMeta }> {
  const collection = db.collection<ServiceDocument>(COLLECTIONS.services);
  const filter = buildManagedServiceFilter(query);
  const vendorSearch = query.vendor?.trim();

  if (vendorSearch) {
    const pattern = new RegExp(escapeRegex(vendorSearch), "i");
    const matchingVendors = await db
      .collection<AdminVendorDocument>("user")
      .find(
        {
          $and: [
            { $or: [{ roles: "vendor" }, { role: "vendor" }] },
            { $or: [{ name: pattern }, { email: pattern }] },
          ],
        },
        { projection: { _id: 1 } }
      )
      .toArray();
    const vendorIds = matchingVendors.map((vendor) => vendor._id.toString());

    if (vendorIds.length === 0) {
      return {
        services: [],
        meta: buildPaginationMeta(query.page, query.limit, 0),
      };
    }

    filter.vendorId = { $in: vendorIds };
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

  const vendorIds = Array.from(
    new Set(
      documents
        .map((document) => document.vendorId)
        .filter(
          (id): id is string => typeof id === "string" && ObjectId.isValid(id)
        )
    )
  ).map((id) => new ObjectId(id));
  const vendorDocuments = vendorIds.length
    ? await db
        .collection<AdminVendorDocument>("user")
        .find(
          { _id: { $in: vendorIds } },
          { projection: { name: 1, email: 1 } }
        )
        .toArray()
    : [];
  const vendorsById = new Map(
    vendorDocuments.map((vendor) => [vendor._id.toString(), vendor])
  );

  return {
    services: documents.map((document) => {
      const service: AdminService = {
        ...toVendorService(document),
        ...(typeof document.vendorId === "string"
          ? { vendorId: document.vendorId }
          : {}),
      };
      const vendor = vendorsById.get(document.vendorId);
      if (typeof vendor?.name === "string" && vendor.name.trim()) {
        service.vendorName = vendor.name;
      }
      if (typeof vendor?.email === "string" && vendor.email.trim()) {
        service.vendorEmail = vendor.email;
      }
      return service;
    }),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

const IMPORTANT_SERVICE_KEYS = [
  "title",
  "category",
  "description",
  "location",
  "price",
  "images",
] as const;

function hasImportantServiceChange(
  current: ServiceDocument,
  patch: VendorServiceUpdate
): boolean {
  return IMPORTANT_SERVICE_KEYS.some((key) => {
    const nextValue = patch[key];
    if (nextValue === undefined) return false;

    if (key === "images" || key === "category") {
      return JSON.stringify(current[key]) !== JSON.stringify(nextValue);
    }

    return current[key] !== nextValue;
  });
}

export async function updateVendorServiceWithApproval(
  vendorId: string,
  id: string,
  patch: VendorServiceUpdate,
  db: Db = getDatabase()
): Promise<VendorService | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const collection = db.collection<ServiceDocument>(COLLECTIONS.services);
  const current = await collection.findOne(buildVendorServiceFilter(vendorId, id));
  if (!current) return null;

  const requiresReview =
    current.approvalStatus !== "pending" && hasImportantServiceChange(current, patch);
  const set: Record<string, unknown> = {
    ...patch,
    updatedAt: new Date(),
  };
  const update: UpdateFilter<ServiceDocument> = {
    $set: set as UpdateFilter<ServiceDocument>["$set"],
  };

  if (requiresReview) {
    set.approvalStatus = "pending";
    (update as { $unset?: Record<string, string> }).$unset = {
      rejectionReason: "",
    };
  }

  const filter = buildVendorServiceFilter(vendorId, id);
  filter.approvalStatus = current.approvalStatus;

  const document = await collection.findOneAndUpdate(filter, update, {
    returnDocument: "after",
  });

  return document ? toVendorService(document) : null;
}

export async function deleteVendorService(
  vendorId: string,
  id: string,
  db: Db = getDatabase()
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;

  const result = await db
    .collection<ServiceDocument>(COLLECTIONS.services)
    .deleteOne(buildVendorServiceFilter(vendorId, id));

  return result.deletedCount === 1;
}

export async function deleteServiceById(
  id: string,
  db: Db = getDatabase()
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;

  const result = await db
    .collection<ServiceDocument>(COLLECTIONS.services)
    .deleteOne({ _id: new ObjectId(id) });

  return result.deletedCount === 1;
}

export async function setServiceActiveById(
  id: string,
  isActive: boolean,
  db: Db = getDatabase()
): Promise<VendorService | null> {
  if (!ObjectId.isValid(id)) return null;

  const document = await db
    .collection<ServiceDocument>(COLLECTIONS.services)
    .findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { isActive, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

  return document ? toVendorService(document) : null;
}
