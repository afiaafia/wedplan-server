import { asyncHandler } from "../middleware/async-handler.js";
import { getAdminDashboardData } from "../models/admin-dashboard.model.js";

export const getAdminDashboard = asyncHandler(async (_req, res) => {
  const data = await getAdminDashboardData();

  res.status(200).json({ success: true, data });
});
