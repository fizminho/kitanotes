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

import { isWithinQuietHours } from "./push.ts";

test("quiet hours handle overnight windows in the user's timezone", () => {
  const prefs={push_enabled:1,reminder_push_enabled:1,shared_note_push_enabled:1,quiet_hours_start:"22:00",quiet_hours_end:"07:00",timezone:"Asia/Kuala_Lumpur"};
  assert.equal(isWithinQuietHours(prefs,new Date("2026-11-22T16:30:00.000Z")),true);
  assert.equal(isWithinQuietHours(prefs,new Date("2026-11-22T08:00:00.000Z")),false);
});

test("quiet hours handle same-day windows and disabled ranges", () => {
  const prefs={push_enabled:1,reminder_push_enabled:1,shared_note_push_enabled:1,quiet_hours_start:"09:00",quiet_hours_end:"17:00",timezone:"Asia/Kuala_Lumpur"};
  assert.equal(isWithinQuietHours(prefs,new Date("2026-11-22T04:00:00.000Z")),true);
  assert.equal(isWithinQuietHours(prefs,new Date("2026-11-22T10:00:00.000Z")),false);
  assert.equal(isWithinQuietHours({...prefs,quiet_hours_start:null,quiet_hours_end:null},new Date("2026-11-22T04:00:00.000Z")),false);
});

test("disabled per-user push preference prevents any subscription lookup", async () => {
  const queries=[];
  const db={prepare(sql){queries.push(sql);return{bind(){return{first:async()=>({push_enabled:0,reminder_push_enabled:1,shared_note_push_enabled:1,quiet_hours_start:null,quiet_hours_end:null,timezone:"Asia/Kuala_Lumpur"}),all:async()=>{throw new Error("Subscriptions must not be queried");}};}};}};
  await sendPushToUser(db,{VAPID_PUBLIC_KEY:"public",VAPID_PRIVATE_KEY:"private",VAPID_SUBJECT:"mailto:test@example.com"},"user-1",{title:"Reminder",body:"Private"}, "reminder");
  assert.equal(queries.length,1);
  assert.match(queries[0],/notification_preferences/);
});
