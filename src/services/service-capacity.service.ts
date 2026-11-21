import {
  ObjectId,
  type ClientSession,
  type Db,
  type Filter,
  type UpdateFilter,
} from "mongodb";
import { COLLECTIONS } from "../config/collections.js";
import { getDatabase, getMongoClient } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import {
  createVendorService,
  findVendorServiceById,
  setVendorServiceActive,
} from "../models/service.model.js";
import type { VendorService, VendorServiceInput } from "../types/service.js";
import type {
  SubscriptionPlanName,
  UserSubscriptionRecord,
} from "../types/user.js";
import {
  FREE_ACTIVE_SERVICE_LIMIT,
  getActiveServiceLimit,
  resolveEffectivePlan,
} from "./subscription-plan.service.js";

export const FREE_PLAN_LIMIT_ERROR_CODE = "FREE_PLAN_LIMIT_REACHED";
export const FREE_PLAN_LIMIT_MESSAGE =
  `Free plan supports at most ${FREE_ACTIVE_SERVICE_LIMIT} active services. ` +
  "Upgrade to Premium or deactivate a service to continue.";

export interface ServiceCounterDocument {
  _id: ObjectId;
  activeCount: number;
  updatedAt: Date;
}

interface CounterFilter {
  _id: ObjectId;
  activeCount?: { $lt?: number; $gt?: number };
}

interface CounterUpdate {
  $inc: { activeCount: number };
  $set: { updatedAt: Date };
}

export interface ServiceCounterStore {
  findOne(filter: CounterFilter): Promise<ServiceCounterDocument | null>;
  countActive(vendorId: string): Promise<number>;
  upsertCounter(document: ServiceCounterDocument): Promise<void>;
  findOneAndUpdate(
    filter: CounterFilter,
    update: CounterUpdate
  ): Promise<ServiceCounterDocument | null>;
}

export interface ServiceMutationContext {
  session: ClientSession;
  plan: SubscriptionPlanName;
  counterStore: ServiceCounterStore;
}

function toVendorObjectId(vendorId: string): ObjectId {
  if (!ObjectId.isValid(vendorId)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid vendor account");
  }

  return new ObjectId(vendorId);
}

export function createMongoServiceCounterStore(
  session: ClientSession
): ServiceCounterStore {
  const counters = getDatabase().collection<ServiceCounterDocument>(
    COLLECTIONS.serviceLimitCounters
  );
  const services = getDatabase().collection(COLLECTIONS.services);

  return {
    async findOne(filter) {
      return counters.findOne(filter as Filter<ServiceCounterDocument>, {
        session,
      });
    },
    async countActive(vendorId) {
      return services.countDocuments(
        { vendorId, isActive: true },
        { session }
      );
    },
    async upsertCounter(document) {
      const { _id, ...values } = document;
      await counters.updateOne(
        { _id },
        { $setOnInsert: values },
        { session, upsert: true }
      );
    },
    async findOneAndUpdate(filter, update) {
      return counters.findOneAndUpdate(
        filter as Filter<ServiceCounterDocument>,
        update as UpdateFilter<ServiceCounterDocument>,
        { session, returnDocument: "after" }
      );
    },
  };
}

export async function ensureServiceCounter(
  vendorId: string,
  store: ServiceCounterStore
): Promise<ServiceCounterDocument> {
  const objectId = toVendorObjectId(vendorId);
  const existing = await store.findOne({ _id: objectId });
  if (existing) return existing;

  const activeCount = await store.countActive(vendorId);
  const document: ServiceCounterDocument = {
    _id: objectId,
    activeCount,
    updatedAt: new Date(),
  };

  await store.upsertCounter(document);
  return (await store.findOne({ _id: objectId })) ?? document;
}

export async function reconcileServiceCounter(
  vendorId: string,
  db: Db = getDatabase()
): Promise<void> {
  if (!ObjectId.isValid(vendorId)) return;

  const objectId = new ObjectId(vendorId);
  const activeCount = await db
    .collection(COLLECTIONS.services)
    .countDocuments({ vendorId, isActive: true });

  await db.collection(COLLECTIONS.serviceLimitCounters).updateOne(
    { _id: objectId },
    { $set: { activeCount, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function reserveServiceSlot(
  vendorId: string,
  store: ServiceCounterStore,
  plan: SubscriptionPlanName
): Promise<ServiceCounterDocument> {
  const objectId = toVendorObjectId(vendorId);
  await ensureServiceCounter(vendorId, store);

  const limit = getActiveServiceLimit(plan);
  const reserved = await store.findOneAndUpdate(
    {
      _id: objectId,
      ...(limit === null ? {} : { activeCount: { $lt: limit } }),
    },
    { $inc: { activeCount: 1 }, $set: { updatedAt: new Date() } }
  );

  if (reserved) return reserved;

  const current = await store.findOne({ _id: objectId });
  throw new AppError(
    403,
    FREE_PLAN_LIMIT_ERROR_CODE,
    FREE_PLAN_LIMIT_MESSAGE,
    {
      plan,
      activeServices: current?.activeCount ?? limit ?? FREE_ACTIVE_SERVICE_LIMIT,
      limit: limit ?? FREE_ACTIVE_SERVICE_LIMIT,
    }
  );
}

export async function releaseServiceSlot(
  vendorId: string,
  store: ServiceCounterStore
): Promise<void> {
  const objectId = toVendorObjectId(vendorId);
  await ensureServiceCounter(vendorId, store);

  await store.findOneAndUpdate(
    { _id: objectId, activeCount: { $gt: 0 } },
    { $inc: { activeCount: -1 }, $set: { updatedAt: new Date() } }
  );
}

export async function withVendorServiceMutation<T>(
  vendorId: string,
  mutation: (context: ServiceMutationContext) => Promise<T>
): Promise<T> {
  const objectId = toVendorObjectId(vendorId);
  const session = getMongoClient().startSession();

  try {
    return await session.withTransaction(
      async () => {
        const vendor = await getDatabase()
          .collection<UserSubscriptionRecord>("user")
          .findOne(
            {
              _id: objectId,
              role: "vendor",
              isBlocked: { $ne: true },
            },
            {
              projection: {
                subscriptionPlan: 1,
                subscriptionExpiresAt: 1,
              },
              session,
            }
          );

        if (!vendor) {
          throw new AppError(
            401,
            "UNAUTHORIZED",
            "Vendor account no longer exists"
          );
        }

        return mutation({
          session,
          plan: resolveEffectivePlan(vendor),
          counterStore: createMongoServiceCounterStore(session),
        });
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 10_000,
      }
    );
  } finally {
    await session.endSession();
  }
}

export async function createVendorServiceWithLimit(
  vendorId: string,
  input: VendorServiceInput
): Promise<VendorService> {
  return withVendorServiceMutation(vendorId, async ({ session, plan, counterStore }) => {
    if (input.isActive) {
      await reserveServiceSlot(vendorId, counterStore, plan);
    }

    return createVendorService(vendorId, input, session);
  });
}

export async function setVendorServiceActiveWithLimit(
  vendorId: string,
  id: string,
  isActive: boolean
): Promise<VendorService | null> {
  return withVendorServiceMutation(vendorId, async ({ session, plan, counterStore }) => {
    const existing = await findVendorServiceById(vendorId, id, session);
    if (!existing) return null;
    if (existing.isActive === isActive) return existing;

    if (isActive) {
      await reserveServiceSlot(vendorId, counterStore, plan);
    }

    const updated = await setVendorServiceActive(
      vendorId,
      id,
      isActive,
      session,
      existing.isActive
    );

    if (!updated) return null;

    if (!isActive) {
      await releaseServiceSlot(vendorId, counterStore);
    }

    return updated;
  });
}
