import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../src/errors/app-error.js";
import {
  IMAGE_UPLOAD_FAILED_CODE,
  IMAGE_UPLOAD_UNAVAILABLE_CODE,
  uploadServiceImages,
} from "../src/services/image-upload.service.js";
import { imageUploadSchema } from "../src/validators/service.validator.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

function errorCode(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

test("image upload validator limits count and payload size", () => {
  assert.deepEqual(
    imageUploadSchema.parse({ images: [{ name: "one.png", data: PNG_BASE64 }] }),
    { images: [{ name: "one.png", data: PNG_BASE64 }] }
  );

  for (const input of [
    { images: [] },
    { images: [{ data: PNG_BASE64, isActive: true }] },
    { images: Array.from({ length: 11 }, () => ({ data: PNG_BASE64 })) },
    { images: [{ data: "x".repeat(8_000_001) }] },
    { images: [{ name: "", data: PNG_BASE64 }] },
  ]) {
    assert.equal(imageUploadSchema.safeParse(input).success, false);
  }
});

test("ImgBB URLs for multiple images are returned for storage in MongoDB", async () => {
  const requests: FormData[] = [];
  const stubFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init?.body as FormData);
    const index = requests.length;
    return new Response(
      JSON.stringify({
        success: true,
        data: { url: `https://i.imgbb.com/photo-${index}.png` },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const result = await uploadServiceImages(
    {
      images: [
        { name: "one.png", data: PNG_DATA_URL },
        { name: "two.png", data: PNG_BASE64 },
      ],
    },
    "test-imgbb-key",
    stubFetch
  );

  assert.deepEqual(result, [
    { url: "https://i.imgbb.com/photo-1.png" },
    { url: "https://i.imgbb.com/photo-2.png" },
  ]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.get("key"), "test-imgbb-key");
  assert.equal(requests[0]?.get("image"), PNG_BASE64);
  assert.equal(requests[0]?.get("name"), "one.png");
});

test("missing ImgBB configuration is reported instead of faking URLs", async () => {
  await assert.rejects(
    uploadServiceImages(
      { images: [{ data: PNG_BASE64 }] },
      undefined,
      (() => Promise.reject(new Error("should not be called"))) as typeof fetch
    ),
    (error: unknown) => errorCode(error) === IMAGE_UPLOAD_UNAVAILABLE_CODE
  );
});

test("non-image and malformed payloads are rejected before calling ImgBB", async () => {
  const stubFetch = (() => {
    throw new Error("ImgBB should not be called");
  }) as unknown as typeof fetch;

  for (const data of [
    "not-base64",
    Buffer.from("hello world").toString("base64"),
    `${PNG_BASE64}not-valid`,
  ]) {
    await assert.rejects(
      uploadServiceImages(
        { images: [{ data }] },
        "test-imgbb-key",
        stubFetch
      ),
      (error: unknown) => errorCode(error) === "VALIDATION_ERROR"
    );
  }
});

test("ImgBB failures are surfaced as upload errors", async () => {
  const failureFetch = (async () =>
    new Response(JSON.stringify({ error: { message: "denied" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  await assert.rejects(
    uploadServiceImages(
      { images: [{ data: PNG_BASE64 }] },
      "test-imgbb-key",
      failureFetch
    ),
    (error: unknown) => errorCode(error) === IMAGE_UPLOAD_FAILED_CODE
  );

  const networkFetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;

  await assert.rejects(
    uploadServiceImages(
      { images: [{ data: PNG_BASE64 }] },
      "test-imgbb-key",
      networkFetch
    ),
    (error: unknown) => errorCode(error) === IMAGE_UPLOAD_FAILED_CODE
  );
});
