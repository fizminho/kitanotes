import test from "node:test";
import assert from "node:assert/strict";
import { applySecurityHeaders } from "./security-headers.ts";

test("security headers are applied to JSON API responses", async () => {
  const request = new Request("https://kitanotes.example/api/auth/me");
  const response = applySecurityHeaders(new Response(JSON.stringify({ ok: true })), request);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.deepEqual(await response.json(), { ok: true });
});

test("HSTS is not added to local HTTP development responses", () => {
  const response = applySecurityHeaders(new Response("ok"), new Request("http://localhost:8787/api/health"));
  assert.equal(response.headers.get("strict-transport-security"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
