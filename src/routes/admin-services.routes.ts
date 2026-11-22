import { Router } from "express";
import {
  listServicesForReview,
  updateServiceApproval,
} from "../controllers/admin-services.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { validate } from "../middleware/validate.js";
import {
  adminServiceApprovalSchema,
  adminServicesQuerySchema,
  mongoIdParamSchema,
} from "../validators/dashboard.validator.js";

export function createAdminServicesRouter(auth: Auth) {
  const router = Router();

  router.use(requireAdmin(auth));

  router.get(
    "/",
    validate(adminServicesQuerySchema, "query"),
    listServicesForReview
  );

  router.patch(
    "/:id/approval",
    validate(mongoIdParamSchema, "params"),
    validate(adminServiceApprovalSchema, "body"),
    updateServiceApproval
  );

  return router;
}
