import type { Db } from "mongodb";
import type Stripe from "stripe";
import { getDatabase } from "./database.js";
import { getStripe } from "./stripe.js";

export interface PaymentDependencies {
  getDb: () => Db;
  getStripeClient: () => Stripe;
  getWebhookSecret: () => string | undefined;
  getPriceId: () => string | undefined;
}

export const defaultPaymentDependencies: PaymentDependencies = {
  getDb: getDatabase,
  getStripeClient: getStripe,
  getWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  getPriceId: () => process.env.STRIPE_PRICE_ID,
};
