export type SubscriptionPlan = "premium";

export type TransactionStatus =
  | "pending"
  | "completed"
  | "failed"
  | "refunded";

export interface TransactionDocument {
  vendorId: string;

  plan: SubscriptionPlan;
  amount: number;
  currency: string;

  stripeSessionId: string;
  stripeSubscriptionId?: string;

  status: TransactionStatus;

  createdAt: Date;
}
