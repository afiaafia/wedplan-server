import { AppError } from "../errors/app-error.js";
import { findFeaturedServices } from "../models/service.model.js";
import {
  FEATURED_SERVICES_DEFAULT_LIMIT,
  FEATURED_SERVICES_MAX_LIMIT,
  type FeaturedServicesData,
} from "../types/service.js";

export const FEATURED_SERVICES_ERROR_CODE = "FEATURED_SERVICES_UNAVAILABLE";

export type FeaturedServicesQuery = (
  limit: number
) => Promise<FeaturedServicesData>;

export function normalizeFeaturedLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return FEATURED_SERVICES_DEFAULT_LIMIT;
  }

  return Math.min(
    Math.max(Math.trunc(limit), 1),
    FEATURED_SERVICES_MAX_LIMIT
  );
}

export async function getFeaturedServices(
  limit: number,
  query: FeaturedServicesQuery = findFeaturedServices
): Promise<FeaturedServicesData> {
  const safeLimit = normalizeFeaturedLimit(limit);

  try {
    const result = await query(safeLimit);

    return {
      services: result.services.slice(0, safeLimit),
      total: result.total,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      500,
      FEATURED_SERVICES_ERROR_CODE,
      "Unable to load featured services right now"
    );
  }
}
