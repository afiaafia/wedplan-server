import { z } from "zod";
import { CUSTOMER_BOOKING_FILTERS } from "../types/customer.js";

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

export const bookingIdParamSchema = z.object({
  id: z.string().trim().regex(OBJECT_ID_PATTERN, "Invalid booking id"),
});

export const customerBookingsQuerySchema = z
  .object({
    status: z.enum(CUSTOMER_BOOKING_FILTERS).default("all"),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export const recentBookingsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(10).default(5),
  })
  .strict();

export const updateCustomerProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
  })
  .strict();

export const profileImageUploadSchema = z
  .object({
    image: z
      .object({
        name: z.string().trim().min(1).max(255).optional(),
        data: z.string().trim().min(1).max(8_000_000),
      })
      .strict(),
  })
  .strict();

export type CustomerBookingsQuery = z.infer<typeof customerBookingsQuerySchema>;
export type RecentBookingsQuery = z.infer<typeof recentBookingsQuerySchema>;
export type UpdateCustomerProfileBody = z.infer<
  typeof updateCustomerProfileSchema
>;
export type ProfileImageUploadBody = z.infer<typeof profileImageUploadSchema>;
