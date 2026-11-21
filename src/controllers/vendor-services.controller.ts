import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import {
  findVendorServices,
  updateVendorService,
} from "../models/service.model.js";
import {
  createVendorServiceWithLimit,
  setVendorServiceActiveWithLimit,
} from "../services/service-capacity.service.js";
import type {
  CreateServiceBody,
  SetServiceActiveBody,
  UpdateServiceBody,
} from "../validators/service.validator.js";

function serviceNotFound(): AppError {
  return new AppError(404, "SERVICE_NOT_FOUND", "Service not found");
}

export const listVendorServices = asyncHandler(async (_req, res) => {
  const services = await findVendorServices(res.locals.vendor.id);

  res.status(200).json({
    success: true,
    data: services,
  });
});

export const createVendorServiceHandler = asyncHandler(async (_req, res) => {
  const input = getValidated<CreateServiceBody>(res);
  const vendorId = res.locals.vendor.id;

  const service = await createVendorServiceWithLimit(vendorId, input);

  res.status(201).json({
    success: true,
    data: service,
  });
});

export const updateVendorServiceHandler = asyncHandler(async (_req, res) => {
  const { id, ...patch } = getValidated<{ id: string } & UpdateServiceBody>(res);
  const vendorId = res.locals.vendor.id;

  const service = await updateVendorService(vendorId, id, patch);

  if (!service) {
    throw serviceNotFound();
  }

  res.status(200).json({
    success: true,
    data: service,
  });
});

export const setVendorServiceActiveHandler = asyncHandler(async (_req, res) => {
  const { id, isActive } = getValidated<
    { id: string } & SetServiceActiveBody
  >(res);
  const vendorId = res.locals.vendor.id;

  const service = await setVendorServiceActiveWithLimit(
    vendorId,
    id,
    isActive
  );

  if (!service) {
    throw serviceNotFound();
  }

  res.status(200).json({
    success: true,
    data: service,
  });
});
