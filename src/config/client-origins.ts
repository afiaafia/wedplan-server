export const PRODUCTION_CLIENT_ORIGIN = "https://wedplan-client-ten.vercel.app";
export const LOCAL_CLIENT_ORIGIN = "http://localhost:3000";

const DEFAULT_CLIENT_ORIGINS = [
  PRODUCTION_CLIENT_ORIGIN,
  LOCAL_CLIENT_ORIGIN,
] as const;

function normalizeConfiguredOrigin(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);

    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.search || parsed.hash) return null;
    if (parsed.pathname !== "/") return null;

    return parsed.origin;
  } catch {
    return null;
  }
}

export function getAllowedClientOrigins(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const configured = [
    normalizeConfiguredOrigin(env.CLIENT_URL),
    ...(env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => normalizeConfiguredOrigin(origin)),
  ];

  return Array.from(
    new Set([
      ...DEFAULT_CLIENT_ORIGINS,
      ...configured.filter((origin): origin is string => origin !== null),
    ])
  );
}

export function getPrimaryClientOrigin(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    normalizeConfiguredOrigin(env.CLIENT_URL) ||
    (env.NODE_ENV === "production"
      ? PRODUCTION_CLIENT_ORIGIN
      : LOCAL_CLIENT_ORIGIN)
  );
}

export function isAllowedClientOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (origin === undefined) return true;
  return allowedOrigins.includes(origin);
}
