import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import {
  LOCAL_CLIENT_ORIGIN,
  PRODUCTION_CLIENT_ORIGIN,
} from "../src/config/client-origins.js";
import type { Auth } from "../src/lib/auth.js";

async function withServer(
  t: { after: (callback: () => void) => void },
  run: (url: string) => Promise<void>
): Promise<void> {
  const server = createApp({} as Auth).listen(0);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;

  await run(`http://127.0.0.1:${address.port}`);
}

test("production and local frontend origins receive credentialed CORS headers", async (t) => {
  await withServer(t, async (url) => {
    for (const origin of [PRODUCTION_CLIENT_ORIGIN, LOCAL_CLIENT_ORIGIN]) {
      const response = await fetch(`${url}/api/health`, {
        headers: { Origin: origin },
      });

      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal(
        response.headers.get("access-control-allow-credentials"),
        "true"
      );
      assert.match(response.headers.get("vary") ?? "", /Origin/i);
    }
  });
});

test("unknown origins are not allowed by CORS", async (t) => {
  await withServer(t, async (url) => {
    const response = await fetch(`${url}/api/health`, {
      headers: { Origin: "https://attacker.example" },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.status, 403);
    assert.equal(
      (await response.json()).error.code,
      "ORIGIN_NOT_ALLOWED"
    );
  });
});

test("credentialed preflight requests are allowed only for allowlisted origins", async (t) => {
  await withServer(t, async (url) => {
    const allowed = await fetch(`${url}/api/vendor/services`, {
      method: "OPTIONS",
      headers: {
        Origin: PRODUCTION_CLIENT_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      PRODUCTION_CLIENT_ORIGIN
    );
    assert.equal(
      allowed.headers.get("access-control-allow-credentials"),
      "true"
    );

    const denied = await fetch(`${url}/api/vendor/services`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "GET",
      },
    });

    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });
});
