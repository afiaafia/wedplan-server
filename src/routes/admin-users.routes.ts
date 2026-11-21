import { Router } from "express";
import {
  getAdminUser,
  listAdminUsers,
  patchAdminUserBlocked,
} from "../controllers/admin-users.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { validate } from "../middleware/validate.js";
import {
  adminUsersQuerySchema,
  mongoIdParamSchema,
  userBlockedSchema,
} from "../validators/dashboard.validator.js";

export function createAdminUsersRouter(auth: Auth) {
  const router = Router();

  router.use(requireAdmin(auth));

  router.get("/", validate(adminUsersQuerySchema, "query"), listAdminUsers);

  router.get("/:id", validate(mongoIdParamSchema, "params"), getAdminUser);

  router.patch(
    "/:id/blocked",
    validate(mongoIdParamSchema, "params"),
    validate(userBlockedSchema, "body"),
    patchAdminUserBlocked
  );

  return router;
}
