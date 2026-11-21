import { Router } from "express";
import type { Db } from "mongodb";
import { createListAdminTransactions } from "../controllers/admin-transactions.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { validate } from "../middleware/validate.js";
import { adminTransactionsQuerySchema } from "../validators/dashboard.validator.js";

export function createAdminTransactionsRouter(auth: Auth, db?: Db) {
  const router = Router();

  router.use(requireAdmin(auth));
  router.get(
    "/",
    validate(adminTransactionsQuerySchema, "query"),
    db ? createListAdminTransactions(() => db) : createListAdminTransactions()
  );

  return router;
}
