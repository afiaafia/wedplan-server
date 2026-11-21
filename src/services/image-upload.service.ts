import { AppError } from "../errors/app-error.js";
import type { ImageUploadBody } from "../validators/service.validator.js";

export const IMAGE_UPLOAD_UNAVAILABLE_CODE = "IMAGE_UPLOAD_UNAVAILABLE";
export const IMAGE_UPLOAD_FAILED_CODE = "IMAGE_UPLOAD_FAILED";

const IMGBB_ENDPOINT = "https://api.imgbb.com/1/upload";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadedServiceImage {
  url: string;
}

function normalizeBase64(value: string): string {
  return value
    .trim()
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
    .replace(/\s/g, "");
}

function isSupportedImage(bytes: Buffer): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) || (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
    (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "GIF8") ||
    (bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP");
}

function invalidImage(name?: string): AppError {
  return new AppError(
    400,
    "VALIDATION_ERROR",
    "Each image must be a supported JPEG, PNG, GIF, or WebP file under 5 MB",
    [{ field: name ? `images.${name}` : "images", message: "invalid image" }]
  );
}

export async function uploadServiceImages(
  input: ImageUploadBody,
  apiKey: string | undefined = process.env.IMGBB_API_KEY,
  fetchImpl: typeof fetch = fetch
): Promise<UploadedServiceImage[]> {
  if (!apiKey) {
    throw new AppError(
      500,
      IMAGE_UPLOAD_UNAVAILABLE_CODE,
      "Image uploads are not configured on the server"
    );
  }

  const uploads: { name?: string; base64: string }[] = [];

  for (const image of input.images) {
    const base64 = normalizeBase64(image.data);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
      throw invalidImage(image.name);
    }

    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !isSupportedImage(bytes)) {
      throw invalidImage(image.name);
    }

    uploads.push({ ...(image.name ? { name: image.name } : {}), base64 });
  }

  const results: UploadedServiceImage[] = [];

  for (const upload of uploads) {
    const form = new FormData();
    form.append("key", apiKey);
    form.append("image", upload.base64);
    if (upload.name) form.append("name", upload.name);

    let response: Response;
    try {
      response = await fetchImpl(IMGBB_ENDPOINT, { method: "POST", body: form });
    } catch {
      throw new AppError(
        502,
        IMAGE_UPLOAD_FAILED_CODE,
        "Image hosting could not be reached. Please try again."
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AppError(
        502,
        IMAGE_UPLOAD_FAILED_CODE,
        "Image hosting returned an invalid response."
      );
    }

    const url = (body as { data?: { url?: unknown } })?.data?.url;
    if (!response.ok || typeof url !== "string" || url.trim() === "") {
      throw new AppError(
        502,
        IMAGE_UPLOAD_FAILED_CODE,
        "The image could not be uploaded. Please try again."
      );
    }

    results.push({ url });
  }

  return results;
}
