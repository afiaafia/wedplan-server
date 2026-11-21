import { asyncHandler } from "../middleware/async-handler.js";
import { getVendorSubscriptionSummary } from "../services/vendor-subscription.service.js";

export const getVendorSubscription = asyncHandler(async (_req, res) => {
  const summary = await getVendorSubscriptionSummary(res.locals.vendor.id);

  res.status(200).json({ success: true, data: summary });
});
