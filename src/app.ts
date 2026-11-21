import express from "express";
import type { Db } from "mongodb";
import cors from "cors";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./lib/auth.js";
import {
  getAllowedClientOrigins,
  getPrimaryClientOrigin,
  isAllowedClientOrigin,
} from "./config/client-origins.js";
import { createAdminBookingsRouter } from "./routes/admin-bookings.routes.js";
import { createAdminDashboardRouter } from "./routes/admin-dashboard.routes.js";
import { createAdminServiceActionsRouter } from "./routes/admin-service-actions.routes.js";
import { createAdminServicesRouter } from "./routes/admin-services.routes.js";
import { createAdminTransactionsRouter } from "./routes/admin-transactions.routes.js";
import { createAdminUsersRouter } from "./routes/admin-users.routes.js";
import { createBookingsRouter } from "./routes/bookings.routes.js";
import { createCustomerRouter } from "./routes/customer.routes.js";
import { createProfileRouter } from "./routes/profile.routes.js";
import { createServicesRouter } from "./routes/services.routes.js";
import { createSubscriptionRouter } from "./routes/subscription.routes.js";
import {
  defaultPaymentDependencies,
  type PaymentDependencies,
} from "./config/payments.js";
import { createVendorBookingsRouter } from "./routes/vendor-bookings.routes.js";
import { createVendorDashboardRouter } from "./routes/vendor-dashboard.routes.js";
import { createVendorServicesRouter } from "./routes/vendor-services.routes.js";
import { createVendorSubscriptionRouter } from "./routes/vendor-subscription.routes.js";
import { createStripeWebhookHandler } from "./controllers/stripe-webhook.controller.js";
import type { ProfileImageUploader } from "./controllers/customer.controller.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

export function createApp(
  auth: Auth,
  options: {
    db?: Db;
    uploadProfileImage?: ProfileImageUploader;
    paymentDependencies?: PaymentDependencies;
  } = {}
) {
  const app = express();
  const allowedOrigins = getAllowedClientOrigins();
  const paymentDeps = options.paymentDependencies ?? defaultPaymentDependencies;
  const webhookHandler = createStripeWebhookHandler(paymentDeps);

  app.set("trust proxy", 1);
  app.use(helmet());

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && !isAllowedClientOrigin(origin, allowedOrigins)) {
      res.status(403).json({
        success: false,
        error: {
          message: "Origin not allowed by CORS",
          code: "ORIGIN_NOT_ALLOWED",
        },
      });
      return;
    }

    next();
  });

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );

  // Better Auth must be mounted before express.json().
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    webhookHandler
  );
  app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json" }),
    webhookHandler
  );

  const imageUploadJsonParser = express.json({ limit: "10mb" });
  app.use("/api/me/image", imageUploadJsonParser);
  app.use("/api/customer/profile/image", imageUploadJsonParser);
  app.use("/api/vendor/services/images", imageUploadJsonParser);

  app.use(express.json());

  // Redirect root requests to the frontend client
  app.get("/", (_req, res) => {
    res.redirect(getPrimaryClientOrigin());
  });

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "WedPlan API is running",
    });
  });

  app.use("/api/services", createServicesRouter(options.db));
  app.use("/api/me", createProfileRouter(auth));
  app.use("/api/bookings", createBookingsRouter(auth, options.db));
  app.use(
    "/api/customer",
    createCustomerRouter(auth, options.db, options.uploadProfileImage)
  );
  const subscriptionRouter = createSubscriptionRouter(auth, paymentDeps);
  app.use("/api/subscriptions", subscriptionRouter);
  app.use("/api/payments", subscriptionRouter);
  app.use("/api/vendor/services", createVendorServicesRouter(auth));
  app.use("/api/vendor/bookings", createVendorBookingsRouter(auth));
  app.use("/api/vendor/dashboard", createVendorDashboardRouter(auth));
  app.use("/api/vendor/subscription", createVendorSubscriptionRouter(auth));
  app.use("/api/admin/dashboard", createAdminDashboardRouter(auth));
  app.use("/api/admin/users", createAdminUsersRouter(auth));
  app.use("/api/admin/services", createAdminServicesRouter(auth));
  app.use("/api/admin/services", createAdminServiceActionsRouter(auth));
  app.use("/api/admin/bookings", createAdminBookingsRouter(auth));
  app.use(
    "/api/admin/transactions",
    createAdminTransactionsRouter(auth, options.db)
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
