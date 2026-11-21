import { z } from "zod";
import {
  FEATURED_SERVICES_DEFAULT_LIMIT,
  FEATURED_SERVICES_MAX_LIMIT,
  SERVICE_CATEGORIES,
} from "../types/service.js";

const categoryValues = SERVICE_CATEGORIES as readonly string[];

export const publicServicesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
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
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(9),
});

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

export type CreateServiceBody = z.infer<typeof createServiceSchema>;
export type UpdateServiceBody = z.infer<typeof updateServiceSchema>;
export type SetServiceActiveBody = z.infer<typeof setServiceActiveSchema>;
