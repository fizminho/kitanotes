import test from "node:test";
import assert from "node:assert/strict";
import { verifyGoogleIdToken } from "./auth.ts";

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
