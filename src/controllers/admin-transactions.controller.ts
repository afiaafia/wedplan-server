import type { Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import { findAdminTransactions } from "../models/transaction.model.js";
import type { AdminTransactionsQuery } from "../validators/dashboard.validator.js";

export function createListAdminTransactions(getDb: () => Db = getDatabase) {
  return asyncHandler(async (req, res) => {
    const query = Object.keys(req.query).length
      ? getValidated<AdminTransactionsQuery>(res)
      : ({ page: 1, limit: 10 } satisfies AdminTransactionsQuery);
    const result = await findAdminTransactions(query, getDb());

    res.status(200).json({
      success: true,
      data: result.transactions,
      meta: result.meta,
    });
  });
}

export const listAdminTransactions = createListAdminTransactions();
