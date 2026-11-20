import { z } from "zod";
import { SERVICE_CATEGORIES } from "../types/service.js";

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

export const serviceIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid service id"),
});
