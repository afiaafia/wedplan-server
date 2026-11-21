import { ObjectId, type Db } from "mongodb";
import { getDatabase } from "../config/database.js";
import { AppError } from "../errors/app-error.js";

const SESSION_COLLECTION = "session";

export async function revokeUserSessions(
  userId: string,
  db: Db = getDatabase()
): Promise<number> {
  if (!ObjectId.isValid(userId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid user id");
  }

  const result = await db
    .collection(SESSION_COLLECTION)
    .deleteMany({ userId: new ObjectId(userId) });

  return result.deletedCount;
}
