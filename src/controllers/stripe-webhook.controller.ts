import { ObjectId, type Db } from "mongodb";
import type { RequestHandler } from "express";
import type Stripe from "stripe";

import { COLLECTIONS } from "../config/collections.js";
import {
  defaultPaymentDependencies,
  type PaymentDependencies,
} from "../config/payments.js";
import {
  assertSubscriptionMatchesPremiumPlan,
  assertTransactionMatchesPlan,
  PREMIUM_PLAN,
  resolvePremiumPlan,
  type PremiumPlanConfig,
} from "../services/premium-plan.service.js";

interface WebhookEventDocument {
  eventId: string;
  status: "processing" | "processed" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

interface WebhookContext {
  db: Db;
  stripe: Stripe;
  plan: PremiumPlanConfig;
  eventId: string;
}

interface TransactionRecord {
  _id: ObjectId;
  vendorId: string;
  vendorEmail?: string;
  plan?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: string;
  createdAt: Date;
  stripeSubscriptionId?: string;
}

const RECLAIM_PROCESSING_AFTER_MS = 5 * 60 * 1000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function getVendorObjectId(vendorId: string): ObjectId {
  if (!ObjectId.isValid(vendorId)) {
    throw new Error("Invalid vendor ID in stored transaction");
  }

  return new ObjectId(vendorId);
}

function isActiveSubscription(subscription: Stripe.Subscription): boolean {
  return subscription.status === "active" || subscription.status === "trialing";
}

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription): number {
  const periodEnd = Math.max(
    ...subscription.items.data.map((item) => item.current_period_end)
  );

  if (!Number.isFinite(periodEnd) || periodEnd <= 0) {
    throw new Error("Subscription billing period could not be determined");
  }

  return periodEnd;
}

function getSubscriptionStartedAt(subscription: Stripe.Subscription): number {
  if (!Number.isFinite(subscription.created) || subscription.created <= 0) {
    throw new Error("Subscription start date could not be determined");
  }

  return subscription.created;
}

function assertVendorAssociation(
  vendorId: string,
  metadata: Record<string, string> | undefined,
  clientReferenceId: string | null | undefined
): void {
  if (clientReferenceId && clientReferenceId !== vendorId) {
    throw new Error("Stripe Checkout vendor ID does not match the transaction");
  }

  if (metadata?.vendorId && metadata.vendorId !== vendorId) {
    throw new Error("Stripe vendor ID does not match the transaction");
  }
}

function getWebhookEventsCollection(db: Db) {
  return db.collection<WebhookEventDocument>(COLLECTIONS.webhookEvents);
}

async function claimStripeEvent(db: Db, eventId: string): Promise<boolean> {
  const events = getWebhookEventsCollection(db);
  const now = new Date();
  const staleProcessingBefore = new Date(
    now.getTime() - RECLAIM_PROCESSING_AFTER_MS
  );

  const reclaimed = await events.findOneAndUpdate(
    {
      eventId,
      $or: [
        { status: "failed" },
        { status: "processing", updatedAt: { $lt: staleProcessingBefore } },
      ],
    },
    { $set: { status: "processing", updatedAt: now } },
    { returnDocument: "after" }
  );

  if (reclaimed) return true;

  try {
    await events.insertOne({
      eventId,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

async function markStripeEventProcessed(db: Db, eventId: string): Promise<void> {
  await getWebhookEventsCollection(db).updateOne(
    { eventId, status: "processing" },
    { $set: { status: "processed", updatedAt: new Date() } }
  );
}

async function markStripeEventFailed(db: Db, eventId: string): Promise<void> {
  try {
    await getWebhookEventsCollection(db).updateOne(
      { eventId, status: "processing" },
      { $set: { status: "failed", updatedAt: new Date() } }
    );
  } catch (error) {
    console.error(`Unable to record failed Stripe event ${eventId}:`, error);
  }
}

async function isLatestCompletedTransaction(
  db: Db,
  vendorId: string,
  transactionId: ObjectId,
  createdAt: Date
): Promise<boolean> {
  const newerTransaction = await db
    .collection(COLLECTIONS.transactions)
    .findOne(
      {
        vendorId,
        status: "completed",
        $or: [
          { createdAt: { $gt: createdAt } },
          { createdAt, _id: { $gt: transactionId } },
        ],
      },
      { sort: { createdAt: -1, _id: -1 } }
    );

  return newerTransaction === null;
}

async function activateVendor(
  db: Db,
  vendorId: string,
  subscriptionId: string,
  periodEnd: number,
  startedAt: number
): Promise<void> {
  const users = db.collection("user");
  const vendorObjectId = getVendorObjectId(vendorId);
  const startedAtDate = new Date(startedAt * 1000);

  const result = await users.updateOne(
    {
      _id: vendorObjectId,
      roles: "vendor",
      isBlocked: { $ne: true },
      $or: [
        { stripeSubscriptionId: subscriptionId },
        { stripeSubscriptionStartedAt: { $exists: false } },
        { stripeSubscriptionStartedAt: { $lte: startedAtDate } },
      ],
    },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: new Date(periodEnd * 1000),
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStartedAt: startedAtDate,
      },
    }
  );

  if (result.matchedCount === 0) {
    const vendor = await users.findOne(
      { _id: vendorObjectId, roles: "vendor" },
      { projection: { _id: 1 } }
    );

    if (!vendor) {
      throw new Error("Vendor account was not found");
    }

    console.info(`Skipping Premium activation for blocked vendor ${vendorId}`);
  }
}

async function deactivateVendor(
  db: Db,
  vendorId: string,
  subscriptionId: string
): Promise<void> {
  await db.collection("user").updateOne(
    {
      _id: getVendorObjectId(vendorId),
      roles: "vendor",
      stripeSubscriptionId: subscriptionId,
    },
    {
      $set: { subscriptionPlan: "free" },
      $unset: {
        subscriptionExpiresAt: "",
        stripeSubscriptionId: "",
        stripeSubscriptionStartedAt: "",
      },
    }
  );
}

async function completeCheckout(
  session: Stripe.Checkout.Session,
  ctx: WebhookContext
): Promise<void> {
  if (session.mode !== "subscription") return;

  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return;
  }

  if (session.metadata?.plan && session.metadata.plan !== PREMIUM_PLAN) {
    throw new Error("Checkout Session does not belong to the Premium plan");
  }

  const transactions = ctx.db.collection<TransactionRecord>(COLLECTIONS.transactions);
  const transaction = await transactions.findOne({
    stripeSessionId: session.id,
  });

  if (!transaction) {
    console.info(`Ignoring Checkout Session without a transaction: ${session.id}`);
    return;
  }

  assertTransactionMatchesPlan(transaction, ctx.plan);

  const vendorId = String(transaction.vendorId);

  assertVendorAssociation(
    vendorId,
    undefined,
    session.client_reference_id
  );

  if (
    session.customer_email &&
    transaction.vendorEmail &&
    session.customer_email.toLowerCase() !== String(transaction.vendorEmail).toLowerCase()
  ) {
    throw new Error("Checkout customer does not match the transaction vendor");
  }

  const subscriptionReference = session.subscription;
  const subscriptionId =
    typeof subscriptionReference === "string"
      ? subscriptionReference
      : subscriptionReference?.id;

  if (!subscriptionId) {
    throw new Error("Checkout Session has no subscription ID");
  }

  const subscription = await ctx.stripe.subscriptions.retrieve(subscriptionId);

  assertSubscriptionMatchesPremiumPlan(subscription, ctx.plan);
  assertVendorAssociation(vendorId, subscription.metadata, undefined);

  if (!isActiveSubscription(subscription)) return;

  const periodEnd = getSubscriptionPeriodEnd(subscription);
  const startedAt = getSubscriptionStartedAt(subscription);
  const now = new Date();

  await transactions.updateOne(
    { stripeSessionId: session.id, status: "pending" },
    {
      $set: {
        status: "completed",
        stripeSubscriptionId: subscription.id,
        stripeEventId: ctx.eventId,
        subscriptionPeriodStart: new Date(startedAt * 1000),
        subscriptionPeriodEnd: new Date(periodEnd * 1000),
        updatedAt: now,
      },
    }
  );

  if (
    !(await isLatestCompletedTransaction(
      ctx.db,
      vendorId,
      transaction._id,
      transaction.createdAt
    ))
  ) {
    return;
  }

  await activateVendor(ctx.db, vendorId, subscription.id, periodEnd, startedAt);
}

async function failCheckout(
  session: Stripe.Checkout.Session,
  ctx: WebhookContext,
  status: "failed" | "cancelled"
): Promise<void> {
  await ctx.db.collection(COLLECTIONS.transactions).updateOne(
    { stripeSessionId: session.id, status: "pending" },
    { $set: { status, stripeEventId: ctx.eventId, updatedAt: new Date() } }
  );
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  ctx: WebhookContext
): Promise<void> {
  const transactions = ctx.db.collection<TransactionRecord>(COLLECTIONS.transactions);
  const transaction = await transactions.findOne({
    stripeSubscriptionId: subscription.id,
  });

  if (!transaction) {
    console.info(`Ignoring subscription without a transaction: ${subscription.id}`);
    return;
  }

  const vendorId = String(transaction.vendorId);

  assertSubscriptionMatchesPremiumPlan(subscription, ctx.plan);
  assertVendorAssociation(vendorId, subscription.metadata, undefined);
  assertTransactionMatchesPlan(transaction, ctx.plan);

  const now = new Date();

  if (isActiveSubscription(subscription)) {
    if (
      !(await isLatestCompletedTransaction(
        ctx.db,
        vendorId,
        transaction._id,
        transaction.createdAt
      ))
    ) {
      return;
    }

    const periodEnd = getSubscriptionPeriodEnd(subscription);
    const startedAt = getSubscriptionStartedAt(subscription);

    await transactions.updateOne(
      { _id: transaction._id },
      {
        $set: {
          status: "completed",
          stripeEventId: ctx.eventId,
          subscriptionPeriodStart: new Date(startedAt * 1000),
          subscriptionPeriodEnd: new Date(periodEnd * 1000),
          updatedAt: now,
        },
      }
    );

    await activateVendor(ctx.db, vendorId, subscription.id, periodEnd, startedAt);
    return;
  }

  const nextStatus = subscription.status === "canceled" ? "cancelled" : "failed";

  await transactions.updateOne(
    { _id: transaction._id },
    { $set: { status: nextStatus, stripeEventId: ctx.eventId, updatedAt: now } }
  );

  await deactivateVendor(ctx.db, vendorId, subscription.id);
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (
    invoice as Stripe.Invoice & {
      subscription?: string | { id: string } | null;
    }
  ).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy.id === "string") return legacy.id;

  const details = invoice.parent?.subscription_details;
  const reference = details?.subscription;
  return typeof reference === "string" ? reference : (reference?.id ?? null);
}

async function handleInvoicePaymentSucceeded(
  invoice: Stripe.Invoice,
  ctx: WebhookContext
): Promise<void> {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const transaction = await ctx.db
    .collection<TransactionRecord>(COLLECTIONS.transactions)
    .findOne({ stripeSubscriptionId: subscriptionId });

  if (!transaction) return;

  const subscription = await ctx.stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscription(subscription, ctx);
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  ctx: WebhookContext
): Promise<void> {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  await ctx.db.collection(COLLECTIONS.transactions).updateOne(
    { stripeSubscriptionId: subscriptionId },
    { $set: { status: "failed", stripeEventId: ctx.eventId, updatedAt: new Date() } }
  );
}

async function processStripeEvent(
  event: Stripe.Event,
  ctx: WebhookContext
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await completeCheckout(event.data.object as Stripe.Checkout.Session, ctx);
      break;

    case "checkout.session.async_payment_failed":
      await failCheckout(event.data.object as Stripe.Checkout.Session, ctx, "failed");
      break;

    case "checkout.session.expired":
      await failCheckout(event.data.object as Stripe.Checkout.Session, ctx, "cancelled");
      break;

    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription, ctx);
      break;

    case "invoice.payment_succeeded":
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice, ctx);
      break;

    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, ctx);
      break;

    default:
      break;
  }
}

export function createStripeWebhookHandler(
  deps: PaymentDependencies = defaultPaymentDependencies
): RequestHandler {
  return async (req, res): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    const webhookSecret = deps.getWebhookSecret();

    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET is not configured");
      res.status(500).json({
        success: false,
        message: "Webhook configuration is incomplete",
      });
      return;
    }

    if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
      res.status(400).json({
        success: false,
        message: "Invalid webhook request",
      });
      return;
    }

    let stripe: Stripe;

    try {
      stripe = deps.getStripeClient();
    } catch (error) {
      console.error("Stripe client initialization failed:", error);
      res.status(500).json({
        success: false,
        message: "Webhook configuration is incomplete",
      });
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (error) {
      console.error("Invalid Stripe webhook signature:", error);
      res.status(400).json({
        success: false,
        message: "Invalid Stripe webhook signature",
      });
      return;
    }

    const db = deps.getDb();
    let claimed = false;

    try {
      claimed = await claimStripeEvent(db, event.id);

      if (!claimed) {
        res.status(200).json({
          success: true,
          received: true,
          duplicate: true,
        });
        return;
      }

      const plan = await resolvePremiumPlan(stripe, deps.getPriceId());
      await processStripeEvent(event, { db, stripe, plan, eventId: event.id });
      await markStripeEventProcessed(db, event.id);

      res.status(200).json({
        success: true,
        received: true,
      });
    } catch (error) {
      console.error(`Stripe webhook processing failed for event ${event.id}:`, error);

      if (claimed) {
        await markStripeEventFailed(db, event.id);
      }

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Webhook processing failed",
        });
      }
    }
  };
}

export const stripeWebhookHandler = createStripeWebhookHandler();
