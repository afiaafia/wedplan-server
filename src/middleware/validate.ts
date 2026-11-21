import type { RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../errors/app-error.js";

export function validate(
  schema: ZodType,
  source: "query" | "params" | "body" = "query"
): RequestHandler {
  return (req, res, next) => {
    const input =
      source === "query" ? req.query : source === "params" ? req.params : req.body;
    const result = schema.safeParse(input);

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

    const previous = (res.locals.validated ?? {}) as Record<string, unknown>;
    res.locals.validated = {
      ...previous,
      ...(result.data as Record<string, unknown>),
    };
    next();
  };
}

export function getValidated<T>(res: Response): T {
  return res.locals.validated as T;
}
