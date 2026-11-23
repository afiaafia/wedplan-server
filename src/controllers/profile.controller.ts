import type { Db } from "mongodb";
import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import { activateVendorAccess } from "../services/role-onboarding.service.js";
import {
  getSessionHeaders,
  type AuthenticatedUser,
} from "../middleware/require-auth.js";
import {
  uploadServiceImages,
  type UploadedServiceImage,
} from "../services/image-upload.service.js";
import type {
  ProfileImageUploadBody,
  UpdateProfileBody,
} from "../validators/profile.validator.js";
import type { ImageUploadBody } from "../validators/service.validator.js";
import type { Auth } from "../lib/auth.js";
import { issueWedPlanJwt } from "../lib/jwt.js";
import { validatePasswordPolicy } from "../lib/password-policy.js";
import type { SetPasswordBody } from "../validators/profile.validator.js";

export type ProfileImageUploader = (
  input: ImageUploadBody
) => Promise<UploadedServiceImage[]>;

const defaultUploader: ProfileImageUploader = (input) =>
  uploadServiceImages(input);

function getBetterAuthErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("body" in error)) {
    return undefined;
  }

  const body = error.body;
  if (
    typeof body !== "object" ||
    body === null ||
    !("code" in body) ||
    typeof body.code !== "string"
  ) {
    return undefined;
  }

  return body.code;
}

export function createProfileController(
  auth: Auth,
  uploadProfileImage: ProfileImageUploader = defaultUploader,
  db?: Db
) {
  const updateUser: RequestHandler = asyncHandler(async (req, res) => {
    const input = getValidated<UpdateProfileBody>(res);
    const user = res.locals.user as AuthenticatedUser;
    const body: Record<string, unknown> = {};

    if (input.name !== undefined) body.name = input.name;
    if (input.image !== undefined) body.image = input.image;
    if (input.businessName !== undefined) {
      if (!user.roles.includes("vendor")) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Only vendors can update a business name"
        );
      }
      body.businessName = input.businessName;
    }

    if (Object.keys(body).length === 0) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Provide at least one profile field to update"
      );
    }

    await auth.api.updateUser({
      headers: getSessionHeaders(req),
      body,
    });

    res.status(200).json({
      success: true,
      data: { id: user.id, ...body },
    });
  });

  return {
    issueToken: asyncHandler(async (_req, res) => {
      const user = res.locals.user as AuthenticatedUser;
      const token = await issueWedPlanJwt({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roles: user.roles,
        isBlocked: user.isBlocked,
      });
      res.status(200).json({
        success: true,
        data: {
          accessToken: token,
          tokenType: "Bearer",
          expiresIn: 15 * 60,
        },
      });
    }),

    get: asyncHandler(async (_req, res) => {
      const user = res.locals.user as AuthenticatedUser;
      res.status(200).json({
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          roles: user.roles,
          isBlocked: user.isBlocked,
        },
      });
    }),

    update: updateUser,

    setPassword: asyncHandler(async (req, res) => {
      const { newPassword } = getValidated<SetPasswordBody>(res);
      const passwordError = validatePasswordPolicy(newPassword);
      if (passwordError) {
        throw new AppError(400, "WEAK_PASSWORD", passwordError);
      }

      const headers = getSessionHeaders(req);
      const accounts = await auth.api.listUserAccounts({ headers });
      if (!accounts.some((account) => account.providerId === "google")) {
        throw new AppError(
          403,
          "GOOGLE_SIGN_IN_REQUIRED",
          "Sign in with Google before setting a password"
        );
      }

      let result: Awaited<ReturnType<Auth["api"]["setPassword"]>>;
      try {
        result = await auth.api.setPassword({
          headers,
          body: { newPassword },
        });
      } catch (error) {
        const code = getBetterAuthErrorCode(error);
        if (code === "PASSWORD_ALREADY_SET") {
          throw new AppError(
            409,
            "PASSWORD_ALREADY_SET",
            "A password is already set for this account"
          );
        }
        if (code === "UNAUTHORIZED") {
          throw new AppError(401, "UNAUTHORIZED", "Please sign in again");
        }

        console.error(
          "Set password operation failed",
          error instanceof Error ? error.name : "UnknownError"
        );
        throw new AppError(
          500,
          "PASSWORD_SET_FAILED",
          "Unable to set the password. Please try again."
        );
      }

      if (!result.status) {
        throw new AppError(
          500,
          "PASSWORD_SET_FAILED",
          "Unable to set the password. Please try again."
        );
      }

      res.status(200).json({
        success: true,
        data: { passwordSet: true },
      });
    }),

    onboardVendor: asyncHandler(async (_req, res) => {
      const user = res.locals.user as AuthenticatedUser;
      const roles = await activateVendorAccess(user.id, db);
      res.status(200).json({
        success: true,
        data: { roles },
      });
    }),

    uploadImage: asyncHandler(async (req, res) => {
      const { image } = getValidated<ProfileImageUploadBody>(res);
      const uploaded = await uploadProfileImage({ images: [image] });
      const url = uploaded[0]?.url?.trim();

      if (!url || !/^https?:\/\//i.test(url)) {
        throw new AppError(
          502,
          "IMAGE_UPLOAD_FAILED",
          "The image host did not return a usable image URL"
        );
      }

      await auth.api.updateUser({
        headers: getSessionHeaders(req),
        body: { image: url },
      });

      res.status(200).json({ success: true, data: { image: url } });
    }),
  };
}
