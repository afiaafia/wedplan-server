import { Router } from "express";
import {
  deleteAdminService,
  moderateServiceActive,
} from "../controllers/admin-service-actions.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { validate } from "../middleware/validate.js";
import {
  adminServiceActiveSchema,
  mongoIdParamSchema,
} from "../validators/dashboard.validator.js";

export function createAdminServiceActionsRouter(auth: Auth) {
  const router = Router();

  router.use(requireAdmin(auth));

  router.patch(
    "/:id/active",
    validate(mongoIdParamSchema, "params"),
    validate(adminServiceActiveSchema, "body"),
    moderateServiceActive
  );

  router.delete(
    "/:id",
    validate(mongoIdParamSchema, "params"),
    deleteAdminService
  );

  return router;
}
