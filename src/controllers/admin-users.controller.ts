import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import {
  findAdminUserById,
  findAdminUsers,
  setUserBlocked,
} from "../models/user.model.js";
import { revokeUserSessions } from "../services/session-revocation.service.js";
import type {
  AdminUsersQuery,
  UserBlockedBody,
} from "../validators/dashboard.validator.js";

type UserIdParams = { id: string };

export const listAdminUsers = asyncHandler(async (req, res) => {
  const query = Object.keys(req.query).length
    ? getValidated<AdminUsersQuery>(res)
    : ({
        q: undefined,
        role: undefined,
        blocked: "all",
        page: 1,
        limit: 10,
      } satisfies AdminUsersQuery);
  const result = await findAdminUsers(query);

  res.status(200).json({
    success: true,
    data: result.users,
    meta: result.meta,
  });
});

export const getAdminUser = asyncHandler(async (_req, res) => {
  const { id } = getValidated<UserIdParams>(res);
  const user = await findAdminUserById(id);

  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  res.status(200).json({ success: true, data: user });
});

export const patchAdminUserBlocked = asyncHandler(async (_req, res) => {
  const { id } = getValidated<UserIdParams>(res);
  const { isBlocked } = getValidated<UserBlockedBody>(res);
  const adminId = res.locals.admin.id;

  const user = await setUserBlocked(adminId, id, isBlocked);

  if (isBlocked) {
    await revokeUserSessions(id);
  }

  res.status(200).json({
    success: true,
    message: isBlocked ? "User blocked" : "User unblocked",
    data: user,
  });
});
