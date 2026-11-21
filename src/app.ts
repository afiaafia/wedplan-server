import express from "express";
import cors from "cors";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./lib/auth.js";
import {
  getAllowedClientOrigins,
  getPrimaryClientOrigin,
  isAllowedClientOrigin,
} from "./config/client-origins.js";
import { servicesRouter } from "./routes/services.routes.js";
import { createSubscriptionRouter } from "./routes/subscription.routes.js";
import { createVendorDashboardRouter } from "./routes/vendor-dashboard.routes.js";
import { createVendorServicesRouter } from "./routes/vendor-services.routes.js";
import { stripeWebhookHandler } from "./controllers/stripe-webhook.controller.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

export function createApp(auth: Auth) {
  const app = express();
  const allowedOrigins = getAllowedClientOrigins();

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
    stripeWebhookHandler
  );

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

  app.use("/api/services", servicesRouter);
  app.use("/api/subscriptions", createSubscriptionRouter(auth));
  app.use("/api/vendor/services", createVendorServicesRouter(auth));
  app.use("/api/vendor/dashboard", createVendorDashboardRouter(auth));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
