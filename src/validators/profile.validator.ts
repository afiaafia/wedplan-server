import { z } from "zod";

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(100).optional(),
    image: z
      .string()
      .trim()
      .url("Image must be a valid URL")
      .regex(/^https?:\/\//i, "Image must use HTTP or HTTPS")
      .max(2048)
      .nullable()
      .optional(),
    businessName: z.string().trim().max(150).nullable().optional(),
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

export const setPasswordSchema = z
  .object({
    newPassword: z.string().min(6).max(128),
  })
  .strict();

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
export type ProfileImageUploadBody = z.infer<
  typeof profileImageUploadSchema
>;
export type SetPasswordBody = z.infer<typeof setPasswordSchema>;
