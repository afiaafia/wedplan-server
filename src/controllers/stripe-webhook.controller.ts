import type { RequestHandler } from "express";
import { MongoServerError, ObjectId } from "mongodb";
import type Stripe from "stripe";

import { getDatabase } from "../config/database.js";
import { COLLECTIONS } from "../config/collections.js";
import { getStripe } from "../config/stripe.js";

interface WebhookEventDocument {
  eventId: string;
  status: "processing" | "processed" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const RECLAIM_PROCESSING_AFTER_MS = 5 * 60 * 1000;

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
  if (
    !Number.isFinite(subscription.created) ||
    subscription.created <= 0
  ) {
    throw new Error("Subscription start date could not be determined");
  }

  return subscription.created;
}

function getWebhookEventsCollection() {
  return getDatabase().collection<WebhookEventDocument>(
    COLLECTIONS.webhookEvents
  );
}

async function claimStripeEvent(eventId: string): Promise<boolean> {
  const now = new Date();
  const staleProcessingBefore = new Date(
    now.getTime() - RECLAIM_PROCESSING_AFTER_MS
  );

  try {
    const result = await getWebhookEventsCollection().updateOne(
      {
        eventId,
        $or: [
          { status: "failed" },
          { status: "processing", updatedAt: { $lt: staleProcessingBefore } },
        ],
      },
      {
        $setOnInsert: { eventId, createdAt: now },
        $set: { status: "processing", updatedAt: now },
      },
      { upsert: true }
    );

    return result.upsertedCount > 0 || result.matchedCount > 0;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return false;
    }

    throw error;
  }
}

async function markStripeEventProcessed(eventId: string): Promise<void> {
  await getWebhookEventsCollection().updateOne(
    { eventId, status: "processing" },
    { $set: { status: "processed", updatedAt: new Date() } }
  );
}

async function markStripeEventFailed(eventId: string): Promise<void> {
  try {
    await getWebhookEventsCollection().updateOne(
      { eventId, status: "processing" },
      { $set: { status: "failed", updatedAt: new Date() } }
    );
  } catch (error) {
    console.error(`Unable to record failed Stripe event ${eventId}:`, error);
  }
}

async function isLatestCompletedTransaction(
  vendorId: string,
  transactionId: unknown,
  createdAt: unknown
): Promise<boolean> {
  if (!(transactionId instanceof ObjectId)) {
    throw new Error("Transaction ID is invalid");
  }

  if (!(createdAt instanceof Date)) {
    throw new Error("Transaction creation date is invalid");
  }

  const newerTransaction = await getDatabase()
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
  vendorId: string,
  subscriptionId: string,
  periodEnd: number,
  startedAt: number
): Promise<void> {
  const users = getDatabase().collection("user");
  const vendorObjectId = getVendorObjectId(vendorId);
  const startedAtDate = new Date(startedAt * 1000);

  const result = await users.updateOne(
    {
      _id: vendorObjectId,
      role: "vendor",
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
      { _id: vendorObjectId, role: "vendor" },
      { projection: { _id: 1 } }
    );

    if (!vendor) {
      throw new Error("Vendor account was not found");
    }
  }
}

async function deactivateVendor(
  vendorId: string,
  subscriptionId: string
): Promise<void> {
  await getDatabase().collection("user").updateOne(
    {
      _id: getVendorObjectId(vendorId),
      role: "vendor",
      stripeSubscriptionId: subscriptionId,
    },
    {
      $set: {
        subscriptionPlan: "free",
      },
      $unset: {
        subscriptionExpiresAt: "",
        stripeSubscriptionId: "",
        stripeSubscriptionStartedAt: "",
      },
    }
  );
}

async function completeCheckout(
  session: Stripe.Checkout.Session
): Promise<void> {
  if (session.mode !== "subscription") return;

  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return;
  }

  const transactions = getDatabase().collection(COLLECTIONS.transactions);

  const transaction = await transactions.findOne({
    stripeSessionId: session.id,
  });

  if (!transaction) {
    throw new Error("No transaction found for the Checkout Session");
  }

  const vendorId = String(transaction.vendorId);

  if (
    session.client_reference_id &&
    session.client_reference_id !== vendorId
  ) {
    throw new Error("Checkout vendor ID does not match the stored transaction");
  }

  const subscriptionReference = session.subscription;

  const subscriptionId =
    typeof subscriptionReference === "string"
      ? subscriptionReference
      : subscriptionReference?.id;

  if (!subscriptionId) {
    throw new Error("Checkout Session has no subscription ID");
  }

  const subscription = await getStripe().subscriptions.retrieve(
    subscriptionId
  );

  if (!isActiveSubscription(subscription)) {
    return;
  }

  if (
    subscription.metadata.vendorId &&
    subscription.metadata.vendorId !== vendorId
  ) {
    throw new Error("Subscription vendor ID does not match the stored transaction");
  }

  const periodEnd = getSubscriptionPeriodEnd(subscription);
  const startedAt = getSubscriptionStartedAt(subscription);

  await transactions.updateOne(
    { stripeSessionId: session.id },
    {
      $set: {
        status: "completed",
        stripeSubscriptionId: subscription.id,
      },
    }
  );

  if (
    !(await isLatestCompletedTransaction(
      vendorId,
      transaction._id,
      transaction.createdAt
    ))
  ) {
    return;
  }

  await activateVendor(vendorId, subscription.id, periodEnd, startedAt);
}

async function expireCheckout(
  session: Stripe.Checkout.Session
): Promise<void> {
  await getDatabase()
    .collection(COLLECTIONS.transactions)
    .updateOne(
      {
        stripeSessionId: session.id,
        status: "pending",
      },
      {
        $set: {
          status: "failed",
        },
      }
    );
}

async function syncSubscription(
  subscription: Stripe.Subscription
): Promise<void> {
  const transaction = await getDatabase()
    .collection(COLLECTIONS.transactions)
    .findOne({
      stripeSubscriptionId: subscription.id,
    });

  if (!transaction) return;

  const vendorId = String(transaction.vendorId);

  if (
    subscription.metadata.vendorId &&
    subscription.metadata.vendorId !== vendorId
  ) {
    throw new Error("Subscription vendor ID does not match the stored transaction");
  }

  if (isActiveSubscription(subscription)) {
    if (
      !(await isLatestCompletedTransaction(
        vendorId,
        transaction._id,
        transaction.createdAt
      ))
    ) {
      return;
    }

    const periodEnd = getSubscriptionPeriodEnd(subscription);
    const startedAt = getSubscriptionStartedAt(subscription);

    await activateVendor(vendorId, subscription.id, periodEnd, startedAt);
    return;
  }

  await deactivateVendor(vendorId, subscription.id);
}

async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await completeCheckout(
        event.data.object as Stripe.Checkout.Session
      );
      break;

    case "checkout.session.expired":
      await expireCheckout(
        event.data.object as Stripe.Checkout.Session
      );
      break;

    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(
        event.data.object as Stripe.Subscription
      );
      break;

    default:
      break;
  }
}

export const stripeWebhookHandler: RequestHandler = async (
  req,
  res
): Promise<void> => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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
    stripe = getStripe();
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
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    );
  } catch (error) {
    console.error("Invalid Stripe webhook signature:", error);
    res.status(400).json({
      success: false,
      message: "Invalid Stripe webhook signature",
    });
    return;
  }

  let claimed = false;

  try {
    claimed = await claimStripeEvent(event.id);

    if (!claimed) {
      console.info(`Skipping duplicate Stripe event: ${event.id}`);
      res.status(200).json({
        success: true,
        received: true,
        duplicate: true,
      });
      return;
    }

    await processStripeEvent(event);
    await markStripeEventProcessed(event.id);

    res.status(200).json({
      success: true,
      received: true,
    });
  } catch (error) {
    console.error(`Stripe webhook processing failed for event ${event.id}:`, error);

    if (claimed) {
      await markStripeEventFailed(event.id);
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Webhook processing failed",
      });
    }
  }
};
