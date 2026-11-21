import { z } from "zod";
import { BOOKING_STATUSES } from "../types/booking.js";
import { SERVICE_CATEGORIES } from "../types/service.js";

export const mongoIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid id"),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const vendorBookingsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(BOOKING_STATUSES).optional(),
  serviceId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid service id")
    .optional(),
});

export const bookingStatusActionSchema = z
  .object({
    action: z.enum(["accept", "reject"]),
  })
  .strict();

export const adminUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  role: z.enum(["customer", "vendor", "admin"]).optional(),
  blocked: z.enum(["all", "true", "false"]).default("all"),
});

export const userBlockedSchema = z
  .object({
    isBlocked: z.boolean(),
  })
  .strict();

export const adminServicesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  isActive: z.enum(["all", "true", "false"]).default("all"),
  category: z.enum(SERVICE_CATEGORIES).optional(),
});

export const adminServiceActiveSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export const adminBookingsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(BOOKING_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  serviceId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid service id")
    .optional(),
  customerId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid customer id")
    .optional(),
  vendorId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid vendor id")
    .optional(),
});

export const adminTransactionsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z
    .enum(["pending", "completed", "failed", "cancelled", "refunded"])
    .optional(),
  vendorId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid vendor id")
    .optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type VendorBookingsQuery = z.infer<typeof vendorBookingsQuerySchema>;
export type BookingStatusAction = z.infer<typeof bookingStatusActionSchema>;
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type UserBlockedBody = z.infer<typeof userBlockedSchema>;
export type AdminServicesQuery = z.infer<typeof adminServicesQuerySchema>;
export type AdminServiceActiveBody = z.infer<typeof adminServiceActiveSchema>;
export type AdminBookingsQuery = z.infer<typeof adminBookingsQuerySchema>;
export type AdminTransactionsQuery = z.infer<
  typeof adminTransactionsQuerySchema
>;
