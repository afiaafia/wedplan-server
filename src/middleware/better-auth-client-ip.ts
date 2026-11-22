import type { Request } from "express";

export const BETTER_AUTH_CLIENT_IP_HEADER = "x-wedplan-client-ip";

export function setBetterAuthClientIp(
  request: Pick<Request, "ip" | "headers">
): void {
  if (request.ip) {
    request.headers[BETTER_AUTH_CLIENT_IP_HEADER] = request.ip;
  } else {
    delete request.headers[BETTER_AUTH_CLIENT_IP_HEADER];
  }
}
