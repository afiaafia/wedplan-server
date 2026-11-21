import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { getDatabase, getMongoClient } from "../config/database.js";
import { getAllowedClientOrigins } from "../config/client-origins.js";
import { resolveRegistrationRole } from "../validators/user.validator.js";

function getValidatedAuthEnv() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error("BETTER_AUTH_SECRET is missing from environment variables");
  }

  const baseURL = process.env.BETTER_AUTH_URL;
  if (!baseURL || baseURL.trim() === "") {
    throw new Error("BETTER_AUTH_URL is missing from environment variables");
  }

  try {
    const parsedUrl = new URL(baseURL);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid HTTP or HTTPS URL");
  }

  const allowedOrigins = getAllowedClientOrigins();

  return { secret, baseURL, allowedOrigins };
}

export function createAuth() {
  const { secret, baseURL, allowedOrigins } = getValidatedAuthEnv();

  return betterAuth({
    baseURL,
    secret,
    trustedOrigins: allowedOrigins,
    database: mongodbAdapter(getDatabase(), {
      client: getMongoClient(),
    }),
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
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
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const body = context?.body as Record<string, unknown> | undefined;
            const role = resolveRegistrationRole(body?.role);

            return {
              data: {
                ...user,
                role,
              },
            };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
