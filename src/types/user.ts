export const USER_ROLES = ["customer", "vendor", "admin"] as const;

export const REGISTRATION_ROLES = ["customer", "vendor"] as const;

export const DEFAULT_USER_ROLE = "customer";

export type UserRole = (typeof USER_ROLES)[number];

export type RegistrationRole = (typeof REGISTRATION_ROLES)[number];
