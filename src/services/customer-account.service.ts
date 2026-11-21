import { ObjectId, type Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { AppError } from "../errors/app-error.js";

const USER_COLLECTION = "user";

interface CustomerAccountRecord {
  role?: unknown;
  isBlocked?: unknown;
}

export async function assertActiveCustomer(
  customerId: string,
  db: Db = getDatabase()
): Promise<void> {
  if (!ObjectId.isValid(customerId)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid customer session");
  }

  const user = await db
    .collection<CustomerAccountRecord>(USER_COLLECTION)
    .findOne(
      { _id: new ObjectId(customerId) },
      { projection: { role: 1, isBlocked: 1 } }
    );

  if (!user) {
    throw new AppError(401, "UNAUTHORIZED", "Your account no longer exists");
  }

  if (user.role !== "customer") {
    throw new AppError(
      403,
      "CUSTOMER_ACCESS_REQUIRED",
      "Only customers can access customer features"
    );
  }

  if (user.isBlocked) {
    throw new AppError(
      403,
      "ACCOUNT_BLOCKED",
      "Your account has been blocked"
    );
  }
}
