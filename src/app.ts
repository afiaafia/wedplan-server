import express from "express";
import cors from "cors";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./lib/auth.js";
import { servicesRouter } from "./routes/services.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

export function createApp(auth: Auth) {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      credentials: true,
    })
  );

  // Better Auth must be mounted before express.json().
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json());

  // Redirect root requests to the frontend client
  app.get("/", (_req, res) => {
    res.redirect(process.env.CLIENT_URL || "http://localhost:3000");
  });

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "WedPlan API is running",
    });
  });

  app.use("/api/services", servicesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
