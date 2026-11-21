import { z } from "zod";
import {
  FEATURED_SERVICES_DEFAULT_LIMIT,
  FEATURED_SERVICES_MAX_LIMIT,
  SERVICE_CATEGORIES,
} from "../types/service.js";

const categoryValues = SERVICE_CATEGORIES as readonly string[];

const publicServicesBaseSchema = z.object({
  q: z.string().trim().max(100).optional(),
  search: z.string().trim().max(100).optional(),
  category: z
    .preprocess(
      (value) => (Array.isArray(value) ? value.join(",") : value),
      z
        .string()
        .trim()
        .max(200)
        .transform((value) =>
          Array.from(
            new Set(
              value
                .split(",")
                .map((category) => category.trim())
                .filter(Boolean)
            )
          )
        )
        .refine(
          (categories) =>
            categories.length > 0 &&
            categories.every((category) => categoryValues.includes(category)),
          { message: "Invalid service category" }
        )
    )
    .optional(),
  location: z.string().trim().max(100).optional(),
  sort: z
    .enum(["recommended", "newest", "price_asc", "price_desc"])
    .default("recommended"),
  sortBy: z.enum(["price"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(9),
});

function resolvePublicSort(input: Record<string, unknown>): string | undefined {
  if (typeof input.sort === "string" && input.sort.length > 0) {
    return input.sort;
  }

  if (input.sortBy === "price") {
    return input.sortOrder === "desc" ? "price_desc" : "price_asc";
  }

  return undefined;
}

export const publicServicesQuerySchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const input = value as Record<string, unknown>;
  const keyword = typeof input.q === "string" ? input.q : input.search;

  return {
    ...input,
    q: keyword,
    sort: resolvePublicSort(input),
  };
}, publicServicesBaseSchema);

export type PublicServicesQuery = z.infer<typeof publicServicesQuerySchema>;

export const featuredServicesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(FEATURED_SERVICES_MAX_LIMIT)
    .default(FEATURED_SERVICES_DEFAULT_LIMIT),
});

export type FeaturedServicesQuery = z.infer<
  typeof featuredServicesQuerySchema
>;

export const serviceIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid service id"),
});

export const vendorServicesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  isActive: z.enum(["all", "true", "false"]).default("all"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type VendorServicesQuery = z.infer<typeof vendorServicesQuerySchema>;

const serviceFields = {
  title: z.string().trim().min(1).max(120),
  category: z.enum(SERVICE_CATEGORIES),
  description: z.string().trim().min(1).max(5000),
  location: z.string().trim().min(1).max(150),
  price: z.number().finite().min(0).max(1_000_000),
  images: z.array(z.string().trim().max(2048)).max(10),
};

export const createServiceSchema = z
  .object({
    ...serviceFields,
    images: serviceFields.images.default([]),
    isActive: z.boolean().default(false),
  })
  .strict();

export const updateServiceSchema = z
  .object(serviceFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one service field is required",
  });

export const setServiceActiveSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export const setServiceApprovalSchema = z
  .object({
    approvalStatus: z.enum(["pending", "approved", "rejected"]),
    rejectionReason:
      z.string().trim().min(5).max(500).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.approvalStatus !== "rejected" ||
      (typeof value.rejectionReason === "string" &&
        value.rejectionReason.trim().length >= 5),
    {
      message: "A rejection reason of at least 5 characters is required",
      path: ["rejectionReason"],
    }
  );

export const imageUploadSchema = z
  .object({
    images: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(255).optional(),
            data: z.string().trim().min(1).max(8_000_000),
          })
          .strict()
      )
      .min(1)
      .max(10),
  })
  .strict();

export type CreateServiceBody = z.infer<typeof createServiceSchema>;
export type UpdateServiceBody = z.infer<typeof updateServiceSchema>;
export type SetServiceActiveBody = z.infer<typeof setServiceActiveSchema>;
export type SetServiceApprovalBody = z.infer<typeof setServiceApprovalSchema>;
export type ImageUploadBody = z.infer<typeof imageUploadSchema>;
