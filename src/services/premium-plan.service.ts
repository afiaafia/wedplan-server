import type Stripe from "stripe";
import { AppError } from "../errors/app-error.js";

export const PREMIUM_PLAN = "premium";
export const PREMIUM_BILLING_INTERVAL = "month";

export interface PremiumPlanConfig {
  priceId: string;
  amount: number;
  unitAmount: number;
  currency: string;
  interval: typeof PREMIUM_BILLING_INTERVAL;
}

export function requirePremiumPriceId(priceId: string | undefined): string {
  if (!priceId || !priceId.trim()) {
    throw new AppError(
      500,
      "STRIPE_PRICE_NOT_CONFIGURED",
      "Subscription price is not configured"
    );
  }

  return priceId.trim();
}

export async function resolvePremiumPlan(
  stripe: Stripe,
  priceId: string | undefined
): Promise<PremiumPlanConfig> {
  const configuredPriceId = requirePremiumPriceId(priceId);
  const price = await stripe.prices.retrieve(configuredPriceId);

  if (!price.active) {
    throw new AppError(
      400,
      "SUBSCRIPTION_PRICE_INACTIVE",
      "The Premium subscription price is currently unavailable"
    );
  }

  if (price.type !== "recurring" || price.recurring?.interval !== PREMIUM_BILLING_INTERVAL) {
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

  if (!price.currency || price.currency.trim() === "") {
    throw new AppError(
      400,
      "INVALID_SUBSCRIPTION_CURRENCY",
      "The configured subscription price has an invalid currency"
    );
  }

  return {
    priceId: configuredPriceId,
    amount: price.unit_amount / 100,
    unitAmount: price.unit_amount,
    currency: price.currency.toLowerCase(),
    interval: PREMIUM_BILLING_INTERVAL,
  };
}

function assertMetadataPlan(metadata: Record<string, string> | undefined): void {
  if (metadata?.plan && metadata.plan !== PREMIUM_PLAN) {
    throw new Error("Stripe object does not belong to the Premium plan");
  }
}

export function assertSubscriptionMatchesPremiumPlan(
  subscription: Stripe.Subscription,
  plan: PremiumPlanConfig
): void {
  assertMetadataPlan(subscription.metadata);

  const matchingItem = subscription.items.data.find(
    (item) => item.price?.id === plan.priceId
  );

  if (!matchingItem) {
    throw new Error("Subscription price does not match the Premium plan");
  }

  const price = matchingItem.price;

  if (price.currency.toLowerCase() !== plan.currency) {
    throw new Error("Subscription currency does not match the Premium plan");
  }

  if (price.unit_amount !== plan.unitAmount) {
    throw new Error("Subscription amount does not match the Premium plan");
  }

  if (price.recurring?.interval !== PREMIUM_BILLING_INTERVAL) {
    throw new Error("Subscription interval does not match the Premium plan");
  }
}

export function assertTransactionMatchesPlan(
  transaction: { amount?: unknown; currency?: unknown; plan?: unknown },
  plan: PremiumPlanConfig
): void {
  if (transaction.plan !== PREMIUM_PLAN) {
    throw new Error("Transaction does not belong to the Premium plan");
  }

  if (transaction.amount !== plan.amount) {
    throw new Error("Transaction amount does not match the Premium plan");
  }

  if (
    typeof transaction.currency !== "string" ||
    transaction.currency.toLowerCase() !== plan.currency
  ) {
    throw new Error("Transaction currency does not match the Premium plan");
  }
}
