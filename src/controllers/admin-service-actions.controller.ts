import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import {
  deleteServiceById,
  findServiceVendorId,
} from "../models/service.model.js";
import {
  reconcileServiceCounter,
  setAdminServiceActiveWithLimit,
} from "../services/service-capacity.service.js";
import type { AdminServiceActiveBody } from "../validators/dashboard.validator.js";
import type { VendorService } from "../types/service.js";

type ServiceIdParams = { id: string };

export interface AdminServiceActivationDependencies {
  findServiceVendorId: typeof findServiceVendorId;
  setServiceActive: typeof setAdminServiceActiveWithLimit;
}

async function serviceOwner(id: string): Promise<string> {
  const vendorId = await findServiceVendorId(id);
  if (!vendorId) {
    throw new AppError(404, "SERVICE_NOT_FOUND", "Service not found");
  }
  return vendorId;
}

export function createModerateServiceActiveHandler(
  dependencies: AdminServiceActivationDependencies = {
    findServiceVendorId,
    setServiceActive: setAdminServiceActiveWithLimit,
  }
) {
  return asyncHandler(async (_req, res) => {
    const { id } = getValidated<ServiceIdParams>(res);
    const { isActive } = getValidated<AdminServiceActiveBody>(res);

    const vendorId = await dependencies.findServiceVendorId(id);
    if (!vendorId) {
      throw new AppError(404, "SERVICE_NOT_FOUND", "Service not found");
    }
    const service: VendorService | null = await dependencies.setServiceActive(
      vendorId,
      id,
      isActive
    );

    if (!service) {
      throw new AppError(404, "SERVICE_NOT_FOUND", "Service not found");
    }

    res.status(200).json({
      success: true,
      message: isActive ? "Service activated" : "Service deactivated",
      data: service,
    });
  });
}

export const moderateServiceActive = createModerateServiceActiveHandler();

export const deleteAdminService = asyncHandler(async (_req, res) => {
  const { id } = getValidated<ServiceIdParams>(res);
  const vendorId = await serviceOwner(id);
  const deleted = await deleteServiceById(id);

  if (!deleted) {
    throw new AppError(404, "SERVICE_NOT_FOUND", "Service not found");
  }

  await reconcileServiceCounter(vendorId);

  res.status(200).json({
    success: true,
    message: "Service deleted",
    data: { id },
  });
});
