import type { Db } from "mongodb";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getValidated } from "../middleware/validate.js";
import {
  cancelCustomerBooking,
  findCustomerBookingById,
  findCustomerBookings,
  findCustomerProfile,
  getCustomerDashboard,
  updateCustomerProfile,
} from "../models/customer.model.js";
import {
  uploadServiceImages,
  type UploadedServiceImage,
} from "../services/image-upload.service.js";
import type {
  CustomerBookingsQuery,
  ProfileImageUploadBody,
  RecentBookingsQuery,
  UpdateCustomerProfileBody,
} from "../validators/customer.validator.js";
import type { ImageUploadBody } from "../validators/service.validator.js";

export type ProfileImageUploader = (
  input: ImageUploadBody,
  apiKey?: string
) => Promise<UploadedServiceImage[]>;

const defaultProfileImageUploader: ProfileImageUploader = (input, apiKey) =>
  uploadServiceImages(input, apiKey);

export function createCustomerController(
  db?: Db,
  uploadProfileImage: ProfileImageUploader = defaultProfileImageUploader
) {
  return {
    dashboard: asyncHandler(async (_req, res) => {
      const { limit } = getValidated<RecentBookingsQuery>(res);
      const customerId = res.locals.customer.id;
      const data = await getCustomerDashboard(customerId, limit, db);

      res.status(200).json({
        success: true,
        data,
        meta: { recentLimit: limit },
      });
    }),

    listBookings: asyncHandler(async (_req, res) => {
      const query = getValidated<CustomerBookingsQuery>(res);
      const customerId = res.locals.customer.id;
      const { bookings, pagination } = await findCustomerBookings(
        customerId,
        query,
        db
      );

      res.status(200).json({
        success: true,
        data: bookings,
        meta: pagination,
      });
    }),

    getBooking: asyncHandler(async (_req, res) => {
      const { id } = getValidated<{ id: string }>(res);
      const customerId = res.locals.customer.id;
      const booking = await findCustomerBookingById(customerId, id, db);

      if (!booking) {
        throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
      }

      res.status(200).json({ success: true, data: booking });
    }),

    cancelBooking: asyncHandler(async (_req, res) => {
      const { id } = getValidated<{ id: string }>(res);
      const customerId = res.locals.customer.id;
      const booking = await cancelCustomerBooking(customerId, id, db);

      res.status(200).json({ success: true, data: booking });
    }),

    getProfile: asyncHandler(async (_req, res) => {
      const customerId = res.locals.customer.id;
      const profile = await findCustomerProfile(customerId, db);

      res.status(200).json({ success: true, data: profile });
    }),

    updateProfile: asyncHandler(async (_req, res) => {
      const input = getValidated<UpdateCustomerProfileBody>(res);
      const customerId = res.locals.customer.id;
      const profile = await updateCustomerProfile(
        customerId,
        { name: input.name },
        db
      );

      res.status(200).json({ success: true, data: profile });
    }),

    uploadProfileImage: asyncHandler(async (_req, res) => {
      const { image } = getValidated<ProfileImageUploadBody>(res);
      const customerId = res.locals.customer.id;

      const uploaded = await uploadProfileImage({ images: [image] });
      const url = uploaded[0]?.url?.trim();

      if (!url || !/^https?:\/\//i.test(url)) {
        throw new AppError(
          502,
          "IMAGE_UPLOAD_FAILED",
          "The image host did not return a usable image URL."
        );
      }

      const profile = await updateCustomerProfile(customerId, { image: url }, db);
      res.status(200).json({ success: true, data: profile });
    }),
  };
}
