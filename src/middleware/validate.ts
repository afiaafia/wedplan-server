import type { RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../errors/app-error.js";

export function validate(
  schema: ZodType,
  source: "query" | "params" = "query"
): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(source === "query" ? req.query : req.params);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || source,
        message: issue.message,
      }));

      next(
        new AppError(
          400,
          "VALIDATION_ERROR",
          "Invalid request parameters",
          details
        )
      );
      return;
    }

    res.locals.validated = result.data;
    next();
  };
}

export function getValidated<T>(res: Response): T {
  return res.locals.validated as T;
}
