import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import { findServicesForReviewPage, setServiceApprovalStatus } from "../models/service.model.js";
import type {
  AdminServiceApprovalBody,
  AdminServicesQuery,
} from "../validators/dashboard.validator.js";

interface ServiceApprovalBody {
  id: string;
}

export const listServicesForReview = asyncHandler(async (req, res) => {
  const query = getValidated<AdminServicesQuery>(res);
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
    getValidated<AdminServiceApprovalBody>(res);

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
