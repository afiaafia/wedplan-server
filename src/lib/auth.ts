import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { ObjectId } from "mongodb";
import { getDatabase, getMongoClient } from "../config/database.js";
import { getAllowedClientOrigins } from "../config/client-origins.js";
import { sendPasswordResetEmail } from "./password-reset-email.js";
import {
  assertRegistrationRole,
  resolveRegistrationRole,
} from "../validators/user.validator.js";

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

const BLOCKED_SIGN_IN_MESSAGE = "Your account has been blocked";

const PROTECTED_USER_FIELDS = [
  "role",
  "isBlocked",
  "subscriptionPlan",
  "subscriptionExpiresAt",
  "stripeSubscriptionId",
  "stripeSubscriptionStartedAt",
] as const;

const PASSWORD_ROUTES = ["/sign-up/email", "/reset-password", "/change-password"];

async function rejectBlockedSession(userId: unknown): Promise<void> {
  if (typeof userId !== "string" || !ObjectId.isValid(userId)) return;

  const user = await getDatabase()
    .collection("user")
    .findOne<{ isBlocked?: unknown }>(
      { _id: new ObjectId(userId) },
      { projection: { isBlocked: 1 } }
    );

  if (user?.isBlocked === true) {
    throw new APIError("FORBIDDEN", {
      message: BLOCKED_SIGN_IN_MESSAGE,
      code: "ACCOUNT_BLOCKED",
    });
  }
}

type CookieSameSite = "lax" | "strict" | "none";

function getCookieSameSite(): CookieSameSite {
  const value = process.env.BETTER_AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();
  if (value === "lax" || value === "strict" || value === "none") {
    return value;
  }
  return "lax";
}

function getValidatedAuthEnv() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error("BETTER_AUTH_SECRET is missing from environment variables");
  }
  if (secret.trim().length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }

  const baseURL = process.env.BETTER_AUTH_URL;
  if (!baseURL || baseURL.trim() === "") {
    throw new Error("BETTER_AUTH_URL is missing from environment variables");
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseURL);
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid HTTP or HTTPS URL");
  }

  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
    throw new Error("BETTER_AUTH_URL must be a valid HTTP or HTTPS URL");
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId?.trim() || !googleClientSecret?.trim()) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured"
    );
  }

  const sameSite = getCookieSameSite();
  const production = process.env.NODE_ENV === "production";
  const secureCookies = production || parsedBaseUrl.protocol === "https:";

  if (sameSite === "none" && !secureCookies) {
    throw new Error(
      "BETTER_AUTH_COOKIE_SAME_SITE=none requires an HTTPS BETTER_AUTH_URL"
    );
  }

  const allowedOrigins = getAllowedClientOrigins();

  return {
    secret,
    baseURL,
    allowedOrigins,
    googleClientId,
    googleClientSecret,
    sameSite,
    secureCookies,
  };
}

export function validatePasswordPolicy(
  password: unknown
): string | null {
  if (typeof password !== "string") {
    return "Password is required";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters long`;
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }
  return null;
}

export function resolveRegistrationUserData(
  user: Record<string, unknown>,
  body: Record<string, unknown> | undefined
): Record<string, unknown> {
  const role = resolveRegistrationRole(body?.role);
  const data: Record<string, unknown> = { ...user };

  for (const field of PROTECTED_USER_FIELDS) {
    delete data[field];
  }

  data.role = role;
  data.isBlocked = false;
  data.subscriptionPlan = "free";

  const businessName = body?.businessName;
  if (
    role === "vendor" &&
    typeof businessName === "string" &&
    businessName.trim().length > 0
  ) {
    data.businessName = businessName.trim().slice(0, 150);
  } else {
    delete data.businessName;
  }

  return data;
}

export function sanitizeUserUpdate(
  user: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...user };
  for (const field of PROTECTED_USER_FIELDS) {
    delete data[field];
  }
  return data;
}

export function hasProtectedUserUpdate(
  body: Record<string, unknown> | undefined
): boolean {
  if (!body) return false;
  return PROTECTED_USER_FIELDS.some((field) => field in body);
}

function createRegistrationPolicyPlugin(): BetterAuthPlugin {
  return {
    id: "wedplan-registration-policy",
    hooks: {
      before: [
        {
          matcher(context) {
            return PASSWORD_ROUTES.includes(context.path ?? "");
          },
          handler: createAuthMiddleware(async (context) => {
            const body = (context.body ?? {}) as Record<string, unknown>;
            const password =
              context.path === "/change-password"
                ? body.newPassword
                : body.password;
            const passwordError = validatePasswordPolicy(password);
            if (passwordError) {
              throw new APIError("BAD_REQUEST", {
                message: passwordError,
                code: "WEAK_PASSWORD",
              });
            }

            if (body.role !== undefined) {
              try {
                assertRegistrationRole(body.role);
              } catch {
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Invalid account role. Only customer and vendor registrations are allowed.",
                  code: "INVALID_REGISTRATION_ROLE",
                });
              }
            }
          }),
        },
        {
          matcher(context) {
            return context.path === "/sign-in/email";
          },
          handler: createAuthMiddleware(async (context) => {
            const body = (context.body ?? {}) as Record<string, unknown>;
            if (typeof body.email !== "string") return;

            const user = await getDatabase()
              .collection("user")
              .findOne<{ isBlocked?: unknown }>(
                { email: body.email.trim().toLowerCase() },
                { projection: { isBlocked: 1 } }
              );

            if (user?.isBlocked === true) {
              throw new APIError("FORBIDDEN", {
                message: BLOCKED_SIGN_IN_MESSAGE,
                code: "ACCOUNT_BLOCKED",
              });
            }
          }),
        },
      ],
    },
  };
}

export function createAuth() {
  const {
    secret,
    baseURL,
    allowedOrigins,
    googleClientId,
    googleClientSecret,
    sameSite,
    secureCookies,
  } = getValidatedAuthEnv();

  return betterAuth({
    baseURL,
    secret,
    trustedOrigins: allowedOrigins,
    plugins: [createRegistrationPolicyPlugin()],
    advanced: {
      cookies: {
        session_token: {
          attributes: {
            httpOnly: true,
            sameSite,
            secure: secureCookies,
            path: "/",
          },
        },
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite,
        secure: secureCookies,
        path: "/",
      },
    },
    database: mongodbAdapter(getDatabase(), {
      client: getMongoClient(),
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      sendResetPassword: sendPasswordResetEmail,
    },
    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        requireLocalEmailVerified: true,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: ["customer", "vendor", "admin"],
          defaultValue: "customer",
          input: false,
        },
        isBlocked: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
        businessName: {
          type: "string",
          required: false,
          input: true,
        },
        subscriptionPlan: {
          type: ["free", "premium"],
          defaultValue: "free",
          input: false,
        },
        subscriptionExpiresAt: {
          type: "date",
          required: false,
          input: false,
        },
        stripeSubscriptionId: {
          type: "string",
          required: false,
          input: false,
        },
        stripeSubscriptionStartedAt: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: false,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            await rejectBlockedSession(session.userId);
          },
        },
      },
      user: {
        create: {
          before: async (user, context) => {
            const body = context?.body as Record<string, unknown> | undefined;
            return { data: resolveRegistrationUserData(user, body) };
          },
        },
        update: {
          before: async (user, context) => {
            const body = context?.body as Record<string, unknown> | undefined;
            if (hasProtectedUserUpdate(body)) {
              throw new APIError("FORBIDDEN", {
                message:
                  "Roles, blocked state, and subscription fields cannot be changed through profile updates",
                code: "PROTECTED_PROFILE_FIELD",
              });
            }
            return { data: sanitizeUserUpdate(user) };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
