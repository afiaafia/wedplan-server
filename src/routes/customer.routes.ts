import { Router } from "express";
import type { Db } from "mongodb";
import { createCustomerController, type ProfileImageUploader } from "../controllers/customer.controller.js";
import type { Auth } from "../lib/auth.js";
import { requireCustomer } from "../middleware/require-customer.js";
import { validate } from "../middleware/validate.js";
import {
  bookingIdParamSchema,
  customerBookingsQuerySchema,
  profileImageUploadSchema,
  recentBookingsQuerySchema,
  updateCustomerProfileSchema,
} from "../validators/customer.validator.js";

export function createCustomerRouter(
  auth: Auth,
  db?: Db,
  uploadProfileImage?: ProfileImageUploader
) {
  const router = Router();
  const controller = createCustomerController(db, uploadProfileImage);

  router.use(requireCustomer(auth));

  router.get(
    "/dashboard",
    validate(recentBookingsQuerySchema, "query"),
    controller.dashboard
  );
  router.get(
    "/bookings",
    validate(customerBookingsQuerySchema, "query"),
    controller.listBookings
  );
  router.get(
    "/bookings/:id",
    validate(bookingIdParamSchema, "params"),
    controller.getBooking
  );
  router.post(
    "/bookings/:id/cancel",
    validate(bookingIdParamSchema, "params"),
    controller.cancelBooking
  );
  router.get("/profile", controller.getProfile);
  router.patch(
    "/profile",
    validate(updateCustomerProfileSchema, "body"),
    controller.updateProfile
  );
  router.post(
    "/profile/image",
    validate(profileImageUploadSchema, "body"),
    controller.uploadProfileImage
  );

  return router;
}
