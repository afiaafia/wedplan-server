import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import { findPublicServices, findPublicServiceById } from "../models/service.model.js";
import { getFeaturedServices } from "../services/featured-services.service.js";
import type {
  FeaturedServicesQuery,
  PublicServicesQuery,
} from "../validators/service.validator.js";

export const listPublicServices = asyncHandler(async (_req, res) => {
  const query = getValidated<PublicServicesQuery>(res);
  const { services, total } = await findPublicServices(query);
  const totalPages = Math.ceil(total / query.limit);

  res.status(200).json({
    success: true,
    data: services,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  });
});

export const listFeaturedServices = asyncHandler(async (_req, res) => {
  const { limit } = getValidated<FeaturedServicesQuery>(res);
  const { services, total } = await getFeaturedServices(limit);

  res.status(200).json({
    success: true,
    data: {
      services,
      total,
    },
    meta: {
      limit,
    },
  });
});

export const getPublicServiceById = asyncHandler(async (_req, res) => {
  const { id } = getValidated<{ id: string }>(res);
  const service = await findPublicServiceById(id);

  if (!service) {
    throw new AppError(404, "SERVICE_NOT_FOUND", "Service not found");
  }

  res.status(200).json({
    success: true,
    data: service,
  });
});
