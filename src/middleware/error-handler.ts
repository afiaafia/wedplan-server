import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.method} ${req.originalUrl} not found`,
      code: "NOT_FOUND",
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        message: "Invalid request parameters",
        code: "VALIDATION_ERROR",
        details: error.issues.map((issue) => ({
          field: issue.path.join(".") || "request",
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({
      success: false,
      error: {
        message: "Invalid JSON body",
        code: "INVALID_JSON",
      },
    });
    return;
  }

  console.error("Unhandled API error:", error);

  res.status(500).json({
    success: false,
    error: {
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    },
  });
};
