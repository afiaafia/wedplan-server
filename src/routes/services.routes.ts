import { Router } from "express";
import type { Db } from "mongodb";
import type { Auth } from "../lib/auth.js";
import { requireSession } from "../middleware/require-auth.js";
import {
  createListPublicServicesController,
  createGetPublicServiceController,
  listFeaturedServices,
} from "../controllers/services.controller.js";
import { validate } from "../middleware/validate.js";
import {
  featuredServicesQuerySchema,
  publicServicesQuerySchema,
  serviceIdParamSchema,
} from "../validators/service.validator.js";

export function createServicesRouter(auth: Auth, db?: Db): Router {
  const router = Router();

  router.get(
    "/",
    validate(publicServicesQuerySchema, "query"),
    createListPublicServicesController(db)
  );

  router.get(
    "/featured",
    validate(featuredServicesQuerySchema, "query"),
    listFeaturedServices
  );

  router.get(
    "/:id",
    requireSession(auth),
    validate(serviceIdParamSchema, "params"),
    createGetPublicServiceController(db)
  );

  return router;
}
