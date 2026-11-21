import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getDatabase } from "../config/database.js";
import { COLLECTIONS } from "../config/collections.js";
import { getStripe } from "../config/stripe.js";
import { getPrimaryClientOrigin } from "../config/client-origins.js";
import type { TransactionDocument } from "../types/transaction.js";

export const createCheckoutSession = asyncHandler(async (_req, res) => {
  const vendor = res.locals.vendor;
  const stripe = getStripe();

  const priceId = process.env.STRIPE_PRICE_ID;
  const clientUrl = getPrimaryClientOrigin();

  if (!priceId) {
    throw new AppError(
      500,
      "STRIPE_PRICE_NOT_CONFIGURED",
      "Subscription price is not configured"
    );
  }

  const price = await stripe.prices.retrieve(priceId);

  if (!price.active) {
    throw new AppError(
      400,
      "SUBSCRIPTION_PRICE_INACTIVE",
      "The Premium subscription price is currently unavailable"
    );
  }

  if (
    price.type !== "recurring" ||
    price.recurring?.interval !== "month"
  ) {
    throw new AppError(
      400,
      "INVALID_SUBSCRIPTION_PRICE",
      "The configured Premium price must be a recurring monthly price"
    );
  }

  if (!price.unit_amount || price.unit_amount <= 0) {
    throw new AppError(
      400,
      "INVALID_SUBSCRIPTION_AMOUNT",
      "The configured subscription price has an invalid amount"
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    customer_email: vendor.email,
    client_reference_id: vendor.id,
    metadata: {
      vendorId: vendor.id,
      plan: "premium",
    },
    subscription_data: {
      metadata: {
        vendorId: vendor.id,
        plan: "premium",
      },
    },
    success_url: `${clientUrl}/dashboard/vendor?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientUrl}/dashboard/vendor?subscription=cancelled`,
  });

  if (!session.url) {
    throw new AppError(
      500,
      "CHECKOUT_URL_MISSING",
      "Stripe did not return a Checkout URL"
    );
  }

  const transaction: TransactionDocument = {
    vendorId: vendor.id,
    plan: "premium",
    amount: price.unit_amount / 100,
    currency: price.currency,
    stripeSessionId: session.id,
    status: "pending",
    createdAt: new Date(),
  };

  await getDatabase()
    .collection(COLLECTIONS.transactions)
    .insertOne(transaction);

  res.status(201).json({
    success: true,
    message: "Checkout session created successfully",
    data: {
      checkoutUrl: session.url,
    },
  });
});
