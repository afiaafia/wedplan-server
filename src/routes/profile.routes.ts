import { Router } from "express";
import type { Db } from "mongodb";
import type { Auth } from "../lib/auth.js";
import {
  createProfileController,
  type ProfileImageUploader,
} from "../controllers/profile.controller.js";
import { requireSession } from "../middleware/require-auth.js";
import { validate } from "../middleware/validate.js";
import {
  profileImageUploadSchema,
  setPasswordSchema,
  updateProfileSchema,
} from "../validators/profile.validator.js";
import { requireBetterAuthAdmin } from "../middleware/require-admin.js";

export function createProfileRouter(
  auth: Auth,
  uploadProfileImage?: ProfileImageUploader,
  db?: Db
) {
  const router = Router();
  const controller = createProfileController(auth, uploadProfileImage, db);

  router.post(
    "/password",
    requireBetterAuthAdmin(auth),
    validate(setPasswordSchema, "body"),
    controller.setPassword
  );

  router.use(requireSession(auth));

  router.get("/", controller.get);
  router.post("/token", controller.issueToken);
  router.post("/roles/vendor", controller.onboardVendor);
  router.patch("/", validate(updateProfileSchema, "body"), controller.update);
  router.post(
    "/image",
    validate(profileImageUploadSchema, "body"),
    controller.uploadImage
  );

  return router;
}
