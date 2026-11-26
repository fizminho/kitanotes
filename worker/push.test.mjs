import test from "node:test";
import assert from "node:assert/strict";
import { handlePushRequest, sendPushToUser, safePushMessage } from "./push.ts";

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


test("activity-specific preferences suppress their own push category", async () => {
  const cases=[
    ["event",{event_push_enabled:0},"event"],
    ["workspace",{workspace_push_enabled:0},"workspace"],
    ["shared_note_update",{shared_note_update_push_enabled:0},"shared_note_update"]
  ];
  for(const [label,disabled,kind] of cases){
    const queries=[];
    const preferences={push_enabled:1,reminder_push_enabled:1,shared_note_push_enabled:1,shared_note_update_push_enabled:1,event_push_enabled:1,workspace_push_enabled:1,quiet_hours_start:null,quiet_hours_end:null,timezone:"Asia/Kuala_Lumpur",...disabled};
    const db={prepare(sql){queries.push(sql);return{bind(){return{first:async()=>preferences,all:async()=>{throw new Error("Suppressed push must not load subscriptions");}};}};}};
    await sendPushToUser(db,{VAPID_PUBLIC_KEY:"public",VAPID_PRIVATE_KEY:"private",VAPID_SUBJECT:"mailto:test@example.com"},"user-1",{title:"Activity",body:"Generic update"},kind);
    assert.equal(queries.length,1,String(label)+" preference should suppress subscription lookup");
    assert.match(queries[0],/notification_preferences/);
  }
});


function authenticatedPushDb(){
  const buckets=new Map();
  return {
    prepare(sql){
      return {bind(...values){
        return {
          first:async()=>{
            if(sql.includes("FROM sessions s JOIN users u"))return{id:"user-1",email:"one@example.com",display_name:"One",avatar_url:null,expires_at:"2099-01-01T00:00:00.000Z",personal_workspace_id:"workspace-1"};
            if(sql.includes("INSERT INTO request_rate_limits")){
              const key=values[0];const count=(buckets.get(key)??0)+1;buckets.set(key,count);
              return count<=values[3]?{request_count:count}:null;
            }
            if(sql.includes("FROM notification_preferences"))return{push_enabled:0};
            return null;
          },
          run:async()=>({meta:{changes:1}}),
          all:async()=>({results:[]})
        };
      }};
    }
  };
}

test("push subscription requests reject oversized JSON bodies",async()=>{
  const db=authenticatedPushDb();
  const response=await handlePushRequest(new Request("https://kitanotes.example/api/push/subscriptions",{
    method:"POST",
    headers:{cookie:"__Host-kitanotes_session=test-session",origin:"https://kitanotes.example","content-type":"application/json","content-length":"70000"},
    body:"{}"
  }),{DB:db,VAPID_PUBLIC_KEY:"public",VAPID_PRIVATE_KEY:"private",VAPID_SUBJECT:"mailto:test@example.com"});
  assert.equal(response?.status,400);
  assert.equal((await response?.json()).error,"INVALID_PUSH_SUBSCRIPTION");
});

test("push test endpoint limits repeated sends per user",async()=>{
  const db=authenticatedPushDb();
  const env={DB:db,VAPID_PUBLIC_KEY:"public",VAPID_PRIVATE_KEY:"private",VAPID_SUBJECT:"mailto:test@example.com"};
  const makeRequest=()=>new Request("https://kitanotes.example/api/push/test",{
    method:"POST",headers:{cookie:"__Host-kitanotes_session=test-session",origin:"https://kitanotes.example"}
  });
  const responses=[];
  for(let i=0;i<4;i++)responses.push(await handlePushRequest(makeRequest(),env));
  assert.deepEqual(responses.map(response=>response?.status),[200,200,200,429]);
});


test("push payload messages never include private note, event, reminder or workspace content",()=>{
  const cases=[
    ["reminder","Reminder due","A reminder is due. Open KitaNotes to review it."],
    ["shared_note","New shared note","Someone added a note in a shared workspace. Open KitaNotes to view it."],
    ["shared_note_update","Shared note changed","A shared note was updated or removed. Open KitaNotes to review it."],
    ["event","Calendar activity","A calendar event was created, changed or cancelled. Open KitaNotes to review it."],
    ["workspace","Workspace activity","Your workspace membership or permissions changed. Open KitaNotes to review it."],
    ["test","KitaNotes","Push notifications are connected on this device."]
  ];
  for(const [kind,title,body] of cases){
    const message=safePushMessage(kind);
    assert.deepEqual(message,{title,body});
    assert.doesNotMatch(JSON.stringify(message),/secret note|private event|family reminder|workspace name/i);
  }
});

test("workspace important-only preference suppresses ordinary shared updates",async()=>{
 const queries=[];
 const db={prepare(sql){queries.push(sql);return{bind(){return{first:async()=>sql.includes("workspace_notification_preferences")?{mode:"important"}:sql.includes("notification_preferences")?{push_enabled:1,reminder_push_enabled:1,shared_note_push_enabled:1,shared_note_update_push_enabled:1,event_push_enabled:1,workspace_push_enabled:1,quiet_hours_start:null,quiet_hours_end:null,timezone:"Asia/Kuala_Lumpur"}:null,all:async()=>({results:[]})};}};}};
 await sendPushToUser(db,{VAPID_PUBLIC_KEY:"public",VAPID_PRIVATE_KEY:"private",VAPID_SUBJECT:"mailto:test@example.com"},"user-1",{title:"Note updated",body:"Private",url:"/"}, "shared_note_update",{workspaceId:"workspace-1",important:false});
 assert.equal(queries.some(sql=>sql.includes("push_subscriptions")),false);
});
