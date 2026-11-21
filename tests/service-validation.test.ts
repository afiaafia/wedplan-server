import test from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../src/errors/app-error.js";
import { getValidated, validate } from "../src/middleware/validate.js";
import {
  createServiceSchema,
  serviceIdParamSchema,
  setServiceActiveSchema,
  updateServiceSchema,
} from "../src/validators/service.validator.js";

const validService = {
  title: "Wedding photography",
  category: "Photography",
  description: "Full day wedding coverage",
  location: "Lagos",
  price: 250000,
  images: ["https://example.com/photo.jpg"],
};

function runValidate(
  handler: ReturnType<typeof validate>,
  req: { params?: unknown; body?: unknown; query?: unknown },
  res: { locals: Record<string, unknown> }
): unknown {
  let nextError: unknown;
  handler(
    req as Request,
    { locals: res.locals } as Response,
    ((error?: unknown) => {
      nextError = error;
    }) as NextFunction
  );
  return nextError;
}

test("service creation accepts only vendor-owned service fields", () => {
  const parsed = createServiceSchema.parse(validService);

  assert.equal(parsed.isActive, false);
  assert.equal(createServiceSchema.safeParse({ ...validService, isActive: true }).success, true);
  assert.equal(createServiceSchema.safeParse({ ...validService, plan: "premium" }).success, false);
  assert.equal(createServiceSchema.safeParse({ ...validService, vendorId: "other" }).success, false);
  assert.equal(createServiceSchema.safeParse({ ...validService, approvalStatus: "approved" }).success, false);
});

test("service creation rejects invalid categories and prices", () => {
  assert.equal(createServiceSchema.safeParse({ ...validService, category: "Dance" }).success, false);
  assert.equal(createServiceSchema.safeParse({ ...validService, price: -1 }).success, false);
  assert.equal(createServiceSchema.safeParse({ ...validService, title: "" }).success, false);
});

test("service updates cannot change ownership, approval, or active state", () => {
  assert.equal(updateServiceSchema.safeParse({ price: 1000 }).success, true);
  assert.equal(updateServiceSchema.safeParse({ isActive: true }).success, false);
  assert.equal(updateServiceSchema.safeParse({ vendorId: "other" }).success, false);
  assert.equal(updateServiceSchema.safeParse({ approvalStatus: "approved" }).success, false);
  assert.equal(updateServiceSchema.safeParse({}).success, false);
});

test("activation endpoint accepts only a boolean", () => {
  assert.deepEqual(setServiceActiveSchema.parse({ isActive: true }), {
    isActive: true,
  });
  assert.equal(setServiceActiveSchema.safeParse({ isActive: "true" }).success, false);
  assert.equal(setServiceActiveSchema.safeParse({ isActive: true, plan: "premium" }).success, false);
});

test("validate merges params and body for scoped routes", () => {
  const res = { locals: {} as Record<string, unknown> };
  const id = "507f1f77bcf86cd799439011";

  const firstError = runValidate(validate(serviceIdParamSchema, "params"), { params: { id } }, res);
  const secondError = runValidate(validate(setServiceActiveSchema, "body"), { body: { isActive: true } }, res);

  assert.equal(firstError, undefined);
  assert.equal(secondError, undefined);
  assert.deepEqual(getValidated(res as unknown as Response), {
    id,
    isActive: true,
  });
});

test("invalid body produces a 400 validation error", () => {
  const res = { locals: {} as Record<string, unknown> };

  const error = runValidate(validate(createServiceSchema, "body"), { body: { title: "" } }, res);

  assert.ok(error instanceof AppError);
  assert.equal(error.statusCode, 400);
  assert.equal(error.code, "VALIDATION_ERROR");
});
