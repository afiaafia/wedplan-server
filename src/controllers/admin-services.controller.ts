import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import {
  findServicesForReview,
  findServicesForReviewPage,
  setServiceApprovalStatus,
} from "../models/service.model.js";
import type { AdminServicesQuery } from "../validators/dashboard.validator.js";
import type {
  SetServiceApprovalBody,
  VendorServicesQuery,
} from "../validators/service.validator.js";

interface ServiceApprovalBody {
  id: string;
}

export const listServicesForReview = asyncHandler(async (req, res) => {
  if (Object.keys(req.query).length === 0) {
    const services = await findServicesForReview();
    res.status(200).json({ success: true, data: services });
    return;
  }

  const query = getValidated<AdminServicesQuery & VendorServicesQuery>(res);
  const result = await findServicesForReviewPage(query);

  res.status(200).json({
    success: true,
    data: result.services,
    meta: result.meta,
  });
});

export const updateServiceApproval = asyncHandler(async (_req, res) => {
  const { id } = getValidated<ServiceApprovalBody>(res);
  const { approvalStatus, rejectionReason } =
    getValidated<SetServiceApprovalBody>(res);

  const service = await setServiceApprovalStatus(
    id,
    approvalStatus,
    undefined,
    rejectionReason,
    "pending"
  );

  if (!service) {
    throw new AppError(
      409,
      "SERVICE_NOT_PENDING",
      "Only pending services can be approved or rejected"
    );
  }

  res.status(200).json({
    success: true,
    message: `Service ${approvalStatus}`,
    data: service,
  });
});
