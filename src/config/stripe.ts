import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is missing from environment variables");
  }

  if (!stripe) {
    stripe = new Stripe(secretKey);
  }

  return stripe;
}
