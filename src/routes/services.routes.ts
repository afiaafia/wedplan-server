import { Router } from "express";
import type { Db } from "mongodb";
import {
  createGetPublicServiceController,
  listFeaturedServices,
  listPublicServices,
} from "../controllers/services.controller.js";
import { validate } from "../middleware/validate.js";
import {
  featuredServicesQuerySchema,
  publicServicesQuerySchema,
  serviceIdParamSchema,
} from "../validators/service.validator.js";

export function createServicesRouter(db?: Db): Router {
  const router = Router();

  router.get(
    "/",
    validate(publicServicesQuerySchema, "query"),
    listPublicServices
  );

  router.get(
    "/featured",
    validate(featuredServicesQuerySchema, "query"),
    listFeaturedServices
  );

  router.get(
    "/:id",
    validate(serviceIdParamSchema, "params"),
    createGetPublicServiceController(db)
  );

  return router;
}
