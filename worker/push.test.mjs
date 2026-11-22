import test from "node:test";
import assert from "node:assert/strict";
import { handlePushRequest, sendPushToUser } from "./push.ts";

test("push public key endpoint exposes only the public VAPID key", async () => {
  const response = await handlePushRequest(new Request("https://kitanotes.example/api/push/public-key"), {
    VAPID_PUBLIC_KEY: "public-key",
    VAPID_PRIVATE_KEY: "private-secret",
    VAPID_SUBJECT: "mailto:admin@example.com"
  });
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), { enabled: true, publicKey: "public-key" });
});

test("push public key endpoint reports disabled without complete VAPID config", async () => {
  const response = await handlePushRequest(new Request("https://kitanotes.example/api/push/public-key"), {});
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), { enabled: false, publicKey: null });
});

test("push handler ignores unrelated routes", async () => {
  assert.equal(await handlePushRequest(new Request("https://kitanotes.example/api/notes"), {}), null);
});

test("push delivery fails closed when VAPID is not configured", async () => {
  let queried = false;
  const db = { prepare() { queried = true; throw new Error("DB should not be queried"); } };
  await sendPushToUser(db, {}, "user-1", { title: "Private title", body: "Private body" });
  assert.equal(queried, false);
});
