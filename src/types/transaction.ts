export type SubscriptionPlan = "premium";

export type TransactionStatus =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded";

export interface TransactionDocument {
  vendorId: string;
  vendorEmail?: string;

  plan: SubscriptionPlan;
  amount: number;
  currency: string;
  stripePriceId?: string;

  stripeSessionId: string;
  stripeSubscriptionId?: string;
  stripeEventId?: string;

  status: TransactionStatus;

  subscriptionPeriodStart?: Date;
  subscriptionPeriodEnd?: Date;

  createdAt: Date;
  updatedAt?: Date;
}
