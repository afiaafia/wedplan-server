export function hasValidSessionExpiry(
  expiresAt: unknown,
  now = Date.now()
): boolean {
  let timestamp: number;

  if (expiresAt instanceof Date) {
    timestamp = expiresAt.getTime();
  } else if (typeof expiresAt === "number") {
    timestamp = expiresAt;
  } else if (typeof expiresAt === "string" && expiresAt.trim() !== "") {
    timestamp = Date.parse(expiresAt);
  } else {
    return false;
  }

  return Number.isFinite(timestamp) && timestamp > now;
}
