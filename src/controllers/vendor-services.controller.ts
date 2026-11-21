import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import {
  deleteVendorService,
  findVendorServiceById,
  findVendorServicesPage,
  updateVendorServiceWithApproval,
} from "../models/service.model.js";
import {
  createVendorServiceWithLimit,
  reconcileServiceCounter,
  setVendorServiceActiveWithLimit,
} from "../services/service-capacity.service.js";
import type {
  CreateServiceBody,
  ImageUploadBody,
  SetServiceActiveBody,
  UpdateServiceBody,
  VendorServicesQuery,
} from "../validators/service.validator.js";
import { uploadServiceImages } from "../services/image-upload.service.js";

function serviceNotFound(): AppError {
  return new AppError(404, "SERVICE_NOT_FOUND", "Service not found");
}

export const listVendorServices = asyncHandler(async (_req, res) => {
  const query = getValidated<VendorServicesQuery>(res);
  const result = await findVendorServicesPage(res.locals.vendor.id, query);

  res.status(200).json({
    success: true,
    data: result.services,
    meta: result.meta,
  });
});

export const getVendorService = asyncHandler(async (_req, res) => {
  const { id } = getValidated<{ id: string }>(res);
  const service = await findVendorServiceById(res.locals.vendor.id, id);

  if (!service) throw serviceNotFound();

  res.status(200).json({ success: true, data: service });
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

  const service = await updateVendorServiceWithApproval(vendorId, id, patch);

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

export const deleteVendorServiceHandler = asyncHandler(async (_req, res) => {
  const { id } = getValidated<{ id: string }>(res);
  const vendorId = res.locals.vendor.id;
  const deleted = await deleteVendorService(vendorId, id);

  if (!deleted) throw serviceNotFound();

  await reconcileServiceCounter(vendorId);

  res.status(200).json({
    success: true,
    message: "Service deleted",
    data: { id },
  });
});

export const uploadVendorServiceImagesHandler = asyncHandler(async (_req, res) => {
  const input = getValidated<ImageUploadBody>(res);
  const images = await uploadServiceImages(input);

  res.status(200).json({
    success: true,
    data: { images },
  });
});
