import { ObjectId, type Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { COLLECTIONS } from "../config/collections.js";
import type { AdminTransactionsQuery } from "../validators/dashboard.validator.js";
import type { TransactionDocument } from "../types/transaction.js";
import { buildPaginationMeta, type PaginationMeta } from "../types/dashboard.js";

const USER_COLLECTION = "user";

export interface AdminTransaction {
  id: string;
  vendorId: string;
  vendorName?: string;
  vendorEmail?: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  stripeSessionId?: string;
  stripeSubscriptionId?: string;
  createdAt: string;
  provider: "Stripe";
}

interface AdminTransactionDocument extends TransactionDocument {
  _id: ObjectId;
}

interface VendorIdentity {
  name?: string;
  email?: string;
}

function toAdminTransaction(
  document: AdminTransactionDocument,
  vendors: Map<string, VendorIdentity>,
  includeReference: boolean
): AdminTransaction {
  const transaction: AdminTransaction = {
    id: document._id.toString(),
    vendorId: document.vendorId,
    plan: document.plan,
    amount: document.amount,
    currency: document.currency,
    status: document.status,
    createdAt: document.createdAt.toISOString(),
    provider: "Stripe",
  };

  const vendor = vendors.get(document.vendorId);
  if (vendor) {
    if (vendor.name) transaction.vendorName = vendor.name;
    if (vendor.email) transaction.vendorEmail = vendor.email;
  }

  if (includeReference && typeof document.stripeSessionId === "string") {
    transaction.stripeSessionId = document.stripeSessionId;
  }
  if (typeof document.stripeSubscriptionId === "string") {
    transaction.stripeSubscriptionId = document.stripeSubscriptionId;
  }

  return transaction;
}

export async function findAdminTransactions(
  query: AdminTransactionsQuery,
  db: Db = getDatabase()
): Promise<{ transactions: AdminTransaction[]; meta: PaginationMeta }> {
  const collection = db.collection<AdminTransactionDocument>(COLLECTIONS.transactions);
  const filter: Record<string, unknown> = {};

  if (query.status) filter.status = query.status;
  if (query.vendorId) filter.vendorId = query.vendorId;

  if (query.q) {
    const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matchingVendors = await db
      .collection<VendorIdentity & { _id: ObjectId }>(USER_COLLECTION)
      .find(
        {
          $or: [
            { name: { $regex: escaped, $options: "i" } },
            { email: { $regex: escaped, $options: "i" } },
          ],
        },
        { projection: { name: 1, email: 1 } }
      )
      .toArray();
    const matchingIds = matchingVendors.map((vendor) => vendor._id.toString());

    if (matchingIds.length === 0 || (query.vendorId && !matchingIds.includes(query.vendorId))) {
      return {
        transactions: [],
        meta: buildPaginationMeta(query.page, query.limit, 0),
      };
    }

    filter.vendorId = query.vendorId ?? { $in: matchingIds };
  }

  const [documents, total] = await Promise.all([
    collection
      .find(filter, {
        projection: {
          vendorId: 1,
          plan: 1,
          amount: 1,
          currency: 1,
          status: 1,
          stripeSessionId: 1,
          stripeSubscriptionId: 1,
          createdAt: 1,
        },
      })
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
        .filter((id) => typeof id === "string" && ObjectId.isValid(id))
    )
  ).map((id) => new ObjectId(id));
  const vendorDocuments = vendorIds.length
    ? await db
        .collection<VendorIdentity & { _id: ObjectId }>(USER_COLLECTION)
        .find(
          { _id: { $in: vendorIds } },
          { projection: { name: 1, email: 1 } }
        )
        .toArray()
    : [];
  const vendors = new Map<string, VendorIdentity>(
    vendorDocuments.map((vendor) => [
      vendor._id.toString(),
      {
        ...(typeof vendor.name === "string" && vendor.name.trim()
          ? { name: vendor.name.trim() }
          : { name: "Vendor" }),
        ...(typeof vendor.email === "string" && vendor.email.trim()
          ? { email: vendor.email.trim() }
          : {}),
      },
    ])
  );

  return {
    transactions: documents.map((document) =>
      toAdminTransaction(document, vendors, true)
    ),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}
