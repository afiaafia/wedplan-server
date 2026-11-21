import { Router } from "express";
import {
  createVendorServiceHandler,
  listVendorServices,
  setVendorServiceActiveHandler,
  updateVendorServiceHandler,
} from "../controllers/vendor-services.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireVendor } from "../middleware/require-vendor.js";
import { validate } from "../middleware/validate.js";
import {
  createServiceSchema,
  serviceIdParamSchema,
  setServiceActiveSchema,
  updateServiceSchema,
} from "../validators/service.validator.js";

export function createVendorServicesRouter(auth: Auth) {
  const router = Router();

  router.use(requireVendor(auth));

  router.get("/", listVendorServices);

  router.post(
    "/",
    validate(createServiceSchema, "body"),
    createVendorServiceHandler
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

  return router;
}
