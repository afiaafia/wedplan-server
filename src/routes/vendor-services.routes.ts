import { Router } from "express";
import {
  createVendorServiceHandler,
  deleteVendorServiceHandler,
  getVendorService,
  listVendorServices,
  setVendorServiceActiveHandler,
  updateVendorServiceHandler,
  uploadVendorServiceImagesHandler,
} from "../controllers/vendor-services.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireVendor } from "../middleware/require-vendor.js";
import { validate } from "../middleware/validate.js";
import {
  createServiceSchema,
  imageUploadSchema,
  serviceIdParamSchema,
  setServiceActiveSchema,
  updateServiceSchema,
  vendorServicesQuerySchema,
} from "../validators/service.validator.js";

export function createVendorServicesRouter(auth: Auth) {
  const router = Router();

  router.use(requireVendor(auth));

  router.get("/", validate(vendorServicesQuerySchema, "query"), listVendorServices);

  router.post(
    "/",
    validate(createServiceSchema, "body"),
    createVendorServiceHandler
  );

  router.post(
    "/images",
    validate(imageUploadSchema, "body"),
    uploadVendorServiceImagesHandler
  );

  router.get(
    "/:id",
    validate(serviceIdParamSchema, "params"),
    getVendorService
  );

  router.patch(
    "/:id",
    validate(serviceIdParamSchema, "params"),
    validate(updateServiceSchema, "body"),
    updateVendorServiceHandler
  );

  router.patch(
    "/:id/active",
    validate(serviceIdParamSchema, "params"),
    validate(setServiceActiveSchema, "body"),
    setVendorServiceActiveHandler
  );

  router.delete(
    "/:id",
    validate(serviceIdParamSchema, "params"),
    deleteVendorServiceHandler
  );

  return router;
}
