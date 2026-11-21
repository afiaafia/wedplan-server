import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
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

export type ProfileImageUploader = (
  input: ImageUploadBody
) => Promise<UploadedServiceImage[]>;

const defaultUploader: ProfileImageUploader = (input) =>
  uploadServiceImages(input);

export function createProfileController(
  auth: Auth,
  uploadProfileImage: ProfileImageUploader = defaultUploader
) {
  const updateUser: RequestHandler = asyncHandler(async (req, res) => {
    const input = getValidated<UpdateProfileBody>(res);
    const user = res.locals.user as AuthenticatedUser;
    const body: Record<string, unknown> = {};

    if (input.name !== undefined) body.name = input.name;
    if (input.image !== undefined) body.image = input.image;
    if (input.businessName !== undefined) {
      if (user.role !== "vendor") {
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
    get: asyncHandler(async (_req, res) => {
      const user = res.locals.user as AuthenticatedUser;
      res.status(200).json({
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isBlocked: user.isBlocked,
        },
      });
    }),

    update: updateUser,

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
