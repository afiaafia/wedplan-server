import { Router } from "express";
import { getAdminDashboard } from "../controllers/admin-dashboard.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";

export function createAdminDashboardRouter(auth: Auth) {
  const router = Router();

  router.use(requireAdmin(auth));
  router.get("/", getAdminDashboard);

  return router;
}
