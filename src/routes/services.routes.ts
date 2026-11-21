import { Router } from "express";
import {
  getPublicServiceById,
  listFeaturedServices,
  listPublicServices,
} from "../controllers/services.controller.js";
import { validate } from "../middleware/validate.js";
import {
  featuredServicesQuerySchema,
  publicServicesQuerySchema,
  serviceIdParamSchema,
} from "../validators/service.validator.js";

export const servicesRouter = Router();

servicesRouter.get(
  "/",
  validate(publicServicesQuerySchema, "query"),
  listPublicServices
);

servicesRouter.get(
  "/featured",
  validate(featuredServicesQuerySchema, "query"),
  listFeaturedServices
);

servicesRouter.get(
  "/:id",
  validate(serviceIdParamSchema, "params"),
  getPublicServiceById
);
