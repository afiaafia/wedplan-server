import test from "node:test";
import assert from "node:assert/strict";
import {
  getAllowedClientOrigins,
  getPrimaryClientOrigin,
  isAllowedClientOrigin,
  LOCAL_CLIENT_ORIGIN,
  PRODUCTION_CLIENT_ORIGIN,
} from "../src/config/client-origins.js";

test("production and local origins are always allowed exactly", () => {
  const origins = getAllowedClientOrigins({});

  assert.deepEqual(origins, [PRODUCTION_CLIENT_ORIGIN, LOCAL_CLIENT_ORIGIN]);
  assert.equal(
    isAllowedClientOrigin(PRODUCTION_CLIENT_ORIGIN, origins),
    true
  );
  assert.equal(isAllowedClientOrigin(LOCAL_CLIENT_ORIGIN, origins), true);
  assert.equal(isAllowedClientOrigin("https://attacker.example", origins), false);
});

test("configured origins are normalized and never include wildcards", () => {
  const origins = getAllowedClientOrigins({
    CLIENT_URL: "https://client.example/",
    CORS_ALLOWED_ORIGINS:
      "https://preview.example,not-a-url,http://localhost:3000/,https://attacker.example/path",
  });

  assert.deepEqual(origins, [
    PRODUCTION_CLIENT_ORIGIN,
    LOCAL_CLIENT_ORIGIN,
    "https://client.example",
    "https://preview.example",
  ]);
  assert.equal(isAllowedClientOrigin("*", origins), false);
});

test("the primary client origin follows the environment without arbitrary values", () => {
  assert.equal(getPrimaryClientOrigin({}), LOCAL_CLIENT_ORIGIN);
  assert.equal(
    getPrimaryClientOrigin({ NODE_ENV: "production" }),
    PRODUCTION_CLIENT_ORIGIN
  );
  assert.equal(
    getPrimaryClientOrigin({ CLIENT_URL: "https://client.example/" }),
    "https://client.example"
  );
});
