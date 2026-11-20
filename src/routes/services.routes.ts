import { Router } from "express";
import { getPublicServiceById, listPublicServices } from "../controllers/services.controller.js";
import { validate } from "../middleware/validate.js";
import {
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
  "/:id",
  validate(serviceIdParamSchema, "params"),
  getPublicServiceById
);
