import test from "node:test";
import assert from "node:assert/strict";
import { verifyGoogleIdToken, handleAuthRequest } from "./auth.ts";

const encoder = new TextEncoder();
const encode = (value) => {
  const bytes = encoder.encode(typeof value === "string" ? value : JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

async function signedToken(keyPair, claims) {
  const header = encode({ alg: "RS256", kid: "test-key" });
  const payload = encode(claims);
  const data = header + "." + payload;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, encoder.encode(data));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  const sig = btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return data + "." + sig;
}

test("Google ID token verifier validates signature and OIDC claims", async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const now = Math.floor(Date.now() / 1000);
  const token = await signedToken(pair, { iss: "https://accounts.google.com", aud: "client-id", exp: now + 300, iat: now, nonce: "nonce-1", sub: "google-sub-1", email: "user@example.com", email_verified: true, name: "Test User" });
  const fetchMock = async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: "test-key" }] }), { status: 200 });
  const identity = await verifyGoogleIdToken(token, "client-id", "nonce-1", fetchMock);
  assert.equal(identity.sub, "google-sub-1");
  assert.equal(identity.email, "user@example.com");
  await assert.rejects(() => verifyGoogleIdToken(token, "client-id", "wrong-nonce", fetchMock), /nonce/);
  await assert.rejects(() => verifyGoogleIdToken(token, "wrong-client", "nonce-1", fetchMock), /audience/);
});

test("auth status does not expose configuration values", async () => {
  const response = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/status"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: false });
});

test("Google login start uses state, nonce, PKCE and secure HttpOnly cookie", async () => {
  const response = await handleAuthRequest(new Request("https://kitanotes.test/auth/google"), {
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ request_count: 1 }) }) }) },
    GOOGLE_CLIENT_ID: "public-client-id",
    GOOGLE_CLIENT_SECRET: "test-secret",
    SESSION_SECRET: "x".repeat(48)
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("state"));
  assert.ok(location.searchParams.get("nonce"));
  assert.ok(location.searchParams.get("code_challenge"));
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});
