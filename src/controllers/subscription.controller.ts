import { ObjectId } from "mongodb";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { COLLECTIONS } from "../config/collections.js";
import {
  defaultPaymentDependencies,
  type PaymentDependencies,
} from "../config/payments.js";
import { getPrimaryClientOrigin } from "../config/client-origins.js";
import { resolveEffectivePlan } from "../services/subscription-plan.service.js";
import {
  PREMIUM_PLAN,
  resolvePremiumPlan,
} from "../services/premium-plan.service.js";
import type { TransactionDocument } from "../types/transaction.js";

interface VendorSubscriptionRecord {
  subscriptionPlan?: unknown;
  subscriptionExpiresAt?: unknown;
}

interface PendingTransactionRecord {
  _id: ObjectId;
  stripeSessionId: string;
}

function assertActiveVendor(record: VendorSubscriptionRecord | null): void {
  if (!record) {
    throw new AppError(401, "UNAUTHORIZED", "Vendor account no longer exists");
  }

  if (resolveEffectivePlan(record) === "premium") {
    throw new AppError(
      409,
      "PREMIUM_ALREADY_ACTIVE",
      "You already have an active Premium subscription"
    );
  }
}

export function createCheckoutSessionController(
  deps: PaymentDependencies = defaultPaymentDependencies
) {
  return asyncHandler(async (_req, res) => {
    const vendor = res.locals.vendor;
    const stripe = deps.getStripeClient();
    const db = deps.getDb();
    const clientUrl = getPrimaryClientOrigin();
    const users = db.collection<VendorSubscriptionRecord>("user");
    const transactions = db.collection(COLLECTIONS.transactions);

    const vendorRecord = await users.findOne(
      {
        _id: new ObjectId(vendor.id),
        role: "vendor",
        isBlocked: { $ne: true },
      },
      { projection: { subscriptionPlan: 1, subscriptionExpiresAt: 1 } }
    );

    assertActiveVendor(vendorRecord);

    const plan = await resolvePremiumPlan(stripe, deps.getPriceId());

    const pending = (await transactions
      .find({ vendorId: vendor.id, status: "pending" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .toArray()) as PendingTransactionRecord[];

    const latestPending = pending[0];

    if (latestPending?.stripeSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          latestPending.stripeSessionId
        );

        if (existing.status === "open" && existing.url) {
          res.status(200).json({
            success: true,
            message: "Existing checkout session is still available",
            data: { checkoutUrl: existing.url },
          });
          return;
        }

        await transactions.updateOne(
          { _id: latestPending._id },
          { $set: { status: "cancelled", updatedAt: new Date() } }
        );
      } catch {
        // A missing/inaccessible session is not a reason to block a new checkout.
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan.priceId, quantity: 1 }],
      customer_email: vendor.email,
      client_reference_id: vendor.id,
      metadata: { vendorId: vendor.id, plan: PREMIUM_PLAN },
      subscription_data: {
        metadata: { vendorId: vendor.id, plan: PREMIUM_PLAN },
      },
      success_url: `${clientUrl}/dashboard/vendor/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/dashboard/vendor/payment/cancel`,
    });

    if (!session.url) {
      throw new AppError(
        500,
        "CHECKOUT_URL_MISSING",
        "Stripe did not return a Checkout URL"
      );
    }

    const now = new Date();
    const transaction: TransactionDocument = {
      vendorId: vendor.id,
      vendorEmail: vendor.email,
      plan: PREMIUM_PLAN,
      amount: plan.amount,
      currency: plan.currency,
      stripePriceId: plan.priceId,
      stripeSessionId: session.id,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    await transactions.insertOne(transaction);

    res.status(201).json({
      success: true,
      message: "Checkout session created successfully",
      data: { checkoutUrl: session.url },
    });
  });
}

export const createCheckoutSession = createCheckoutSessionController();
