import { z } from "zod";

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const EVENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseEventDate(value: string): Date | null {
  if (EVENT_DATE_PATTERN.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return date;
  }

  if (ISO_DATE_TIME_PATTERN.test(value)) {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }

  return null;
}

function sanitizeMessage(value: string): string {
  const allowed = Array.from(value).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code >= 32;
  });

  return allowed.join("").trim();
}

export const createBookingSchema = z
  .object({
    serviceId: z
      .string()
      .trim()
      .regex(OBJECT_ID_PATTERN, "Invalid service id"),
    eventDate: z
      .string()
      .trim()
      .min(1, "Event date is required")
      .refine((value) => parseEventDate(value) !== null, {
        message: "Enter a valid event date",
      })
      .refine((value) => {
        const date = parseEventDate(value);
        return date !== null && date.getTime() > Date.now();
      }, { message: "Event date must be in the future" })
      .transform((value) => parseEventDate(value) as Date),
    eventLocation: z
      .string()
      .trim()
      .min(1, "Event location is required")
      .max(150, "Event location must be 150 characters or fewer"),
    message: z
      .string()
      .max(1000, "Message must be 1000 characters or fewer")
      .transform(sanitizeMessage)
      .default(""),
  })
  .strict();

export type CreateBookingBody = z.infer<typeof createBookingSchema>;
