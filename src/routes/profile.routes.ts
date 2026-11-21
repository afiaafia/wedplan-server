import { Router } from "express";
import type { Auth } from "../lib/auth.js";
import {
  createProfileController,
  type ProfileImageUploader,
} from "../controllers/profile.controller.js";
import { requireSession } from "../middleware/require-auth.js";
import { validate } from "../middleware/validate.js";
import {
  profileImageUploadSchema,
  updateProfileSchema,
} from "../validators/profile.validator.js";

export function createProfileRouter(
  auth: Auth,
  uploadProfileImage?: ProfileImageUploader
) {
  const router = Router();
  const controller = createProfileController(auth, uploadProfileImage);

  router.use(requireSession(auth));

  router.get("/", controller.get);
  router.patch("/", validate(updateProfileSchema, "body"), controller.update);
  router.post(
    "/image",
    validate(profileImageUploadSchema, "body"),
    controller.uploadImage
  );

  return router;
}
