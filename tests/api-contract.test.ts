import test from "node:test";
import assert from "node:assert/strict";
import type { ErrorRequestHandler, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../src/errors/app-error.js";
import { errorHandler, notFoundHandler } from "../src/middleware/error-handler.js";

function fakeResponse(): Response & { statusCode?: number; body?: unknown } {
  return {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  } as Response & { statusCode?: number; body?: unknown };
}

function runErrorHandler(error: unknown) {
  const res = fakeResponse();
  (errorHandler as ErrorRequestHandler)(error, {} as Request, res, (() => {}) as never);
  return res;
}

test("AppError responses use the shared frontend error envelope", () => {
  const res = runErrorHandler(
    new AppError(403, "FREE_PLAN_LIMIT_REACHED", "Limit reached", {
      activeServices: 3,
      limit: 3,
    })
  );

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      message: "Limit reached",
      code: "FREE_PLAN_LIMIT_REACHED",
      details: { activeServices: 3, limit: 3 },
    },
  });
});

test("validation errors expose field-level details", () => {
  const result = z.object({ price: z.number().min(1) }).safeParse({ price: 0 });
  assert.equal(result.success, false);
  if (result.success) return;

  const res = runErrorHandler(result.error);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      message: "Invalid request parameters",
      code: "VALIDATION_ERROR",
      details: [{ field: "price", message: result.error.issues[0]?.message }],
    },
  });
});

test("unknown routes return NOT_FOUND in the shared envelope", () => {
  const res = fakeResponse();
  notFoundHandler(
    { method: "GET", originalUrl: "/api/unknown" } as Request,
    res,
    (() => {}) as never
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      message: "Route GET /api/unknown not found",
      code: "NOT_FOUND",
    },
  });
});
