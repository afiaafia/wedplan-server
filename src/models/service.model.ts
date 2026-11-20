import { ObjectId, type Filter, type Sort, type WithId } from "mongodb";
import { COLLECTIONS } from "../config/collections.js";
import { getDatabase } from "../config/database.js";
import type {
  PublicService,
  PublicServiceSort,
  ServiceCategory,
  ServiceDocument,
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPublicFilter(query: PublicServicesQuery): Filter<ServiceDocument> {
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
