import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleNotificationsRequest } from "./notifications.ts";

const migrations=[
 "0001_initial.sql","0002_sessions.sql","0003_invitation_accept_trigger.sql",
 "0004_calendar_reminders_notifications.sql","0005_shared_note_notifications.sql",
 "0006_ai_consent_and_usage.sql","0007_request_rate_limits.sql","0008_push_subscriptions.sql",
 "0009_notification_preferences.sql","0010_gemini_ocr.sql","0011_workspace_visibility.sql",
 "0012_unified_workspace_type.sql","0013_content_audit_and_open_invites.sql",
 "0014_google_calendar_import.sql","0015_notification_activity_preferences.sql",
 "0016_calendar_2_0.sql","0017_calendar_holiday_cache.sql","0018_workspace_starred_default.sql","0023_workspace_notification_preferences.sql","0030_detailed_notification_default.sql"
];
class D1TestDatabase{
 constructor(){this.sqlite=new DatabaseSync(":memory:");this.sqlite.exec("PRAGMA foreign_keys=ON");for(const file of migrations)this.sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));}
 prepare(sql){const db=this.sqlite;return{bind(...values){return{first:async()=>db.prepare(sql).get(...values)??null,all:async()=>({results:db.prepare(sql).all(...values)}),run:async()=>{const r=db.prepare(sql).run(...values);return{meta:{changes:Number(r.changes)}};}};}};}
 close(){this.sqlite.close();}
}
function seed(){
 const db=new D1TestDatabase(),now=new Date().toISOString();
 for(const [id,email] of [["u1","one@example.com"],["u2","two@example.com"]]){
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)").run(id,"sub-"+id,email,email,now,now);
 }
 const tokens={u1:"session-one",u2:"session-two"};
 for(const [userId,token] of Object.entries(tokens))db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)").run("s-"+userId,userId,createHash("sha256").update(token).digest("base64url"),"2099-01-01T00:00:00.000Z",now);
 for(const [id,user,title] of [["n1","u1","Private notification one"],["n2","u2","Private notification two"]]){
  db.sqlite.prepare("INSERT INTO notifications (id,user_id,notification_type,title,body,idempotency_key,created_at) VALUES (?,?,'test',?,'Body',?,?)").run(id,user,title,"key-"+id,now);
 }
 return{db,env:{DB:db},tokens};
}
function request(path,token,method="GET",body){
 const headers={cookie:"__Host-kitanotes_session="+token},init={method,headers};
 if(body!==undefined){headers["content-type"]="application/json";headers.origin="https://kitanotes.test";init.body=typeof body==="string"?body:JSON.stringify(body);}
 return new Request("https://kitanotes.test"+path,init);
}

test("notification list and unread counts are isolated to the authenticated user",async()=>{
 const {db,env,tokens}=seed();
 try{
  const response=await handleNotificationsRequest(request("/api/notifications",tokens.u1),env);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(result.notifications.map(x=>x.id),["n1"]);
  assert.equal(result.unreadCount,1);
 }finally{db.close();}
});

test("users cannot mark another user's notification as read",async()=>{
 const {db,env,tokens}=seed();
 try{
  const response=await handleNotificationsRequest(request("/api/notifications/n2/read",tokens.u1,"POST",{}),env);
  assert.equal(response.status,404);
  assert.equal(db.sqlite.prepare("SELECT read_at FROM notifications WHERE id='n2'").get().read_at,null);
 }finally{db.close();}
});

test("read-all only updates notifications belonging to the authenticated user",async()=>{
 const {db,env,tokens}=seed();
 try{
  const response=await handleNotificationsRequest(request("/api/notifications/read-all",tokens.u1,"POST",{}),env);
  assert.equal(response.status,200);
  assert.notEqual(db.sqlite.prepare("SELECT read_at FROM notifications WHERE id='n1'").get().read_at,null);
  assert.equal(db.sqlite.prepare("SELECT read_at FROM notifications WHERE id='n2'").get().read_at,null);
 }finally{db.close();}
});

test("notification preference endpoint rejects oversized JSON request bodies",async()=>{
 const {db,env,tokens}=seed();
 try{
  const oversized=JSON.stringify({padding:"x".repeat(70*1024)});
  const headers={cookie:"__Host-kitanotes_session="+tokens.u1,"content-type":"application/json",origin:"https://kitanotes.test","content-length":String(new TextEncoder().encode(oversized).length)};
  const response=await handleNotificationsRequest(new Request("https://kitanotes.test/api/notifications/preferences",{method:"PUT",headers,body:oversized}),env);
  assert.equal(response.status,400);
  assert.equal(db.sqlite.prepare("SELECT user_id FROM notification_preferences WHERE user_id='u1'").get(),undefined);
 }finally{db.close();}
});

test("workspace notifications are hidden after membership is revoked",async()=>{
 const {db,env,tokens}=seed();
 try{
  const now=new Date().toISOString();
  db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES ('w1','Private project','u1','shared','shared',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',?),('w1','u2','viewer',?)").run(now,now);
  db.sqlite.prepare("INSERT INTO notifications (id,user_id,workspace_id,notification_type,title,body,idempotency_key,created_at) VALUES ('shared-n','u2','w1','shared_note','Private project','Sensitive note title','shared-key',?)").run(now);

  const before=await handleNotificationsRequest(request("/api/notifications",tokens.u2),env);
  assert.equal(before.status,200);
  assert.equal((await before.json()).notifications.length,2);

  db.sqlite.prepare("DELETE FROM workspace_members WHERE workspace_id='w1' AND user_id='u2'").run();
  const after=await handleNotificationsRequest(request("/api/notifications",tokens.u2),env);
  assert.equal(after.status,200);
  const result=await after.json();
  assert.deepEqual(result.notifications.map(item=>item.id),["n2"]);
  assert.equal(result.unreadCount,1);
  assert.deepEqual(result.unreadByWorkspace,{});
 }finally{db.close();}
});

test("legacy all workspace preference is stored as detailed",async()=>{
 const {db,env,tokens}=seed();
 try{
  const now=new Date().toISOString();
  db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES ('w1','Workspace','u1','shared','shared',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',?)").run(now);
  const response=await handleNotificationsRequest(request("/api/notifications/workspaces/w1",tokens.u1,"PUT",{mode:"all"}),env);
  assert.equal(response.status,200);
  assert.equal(db.sqlite.prepare("SELECT mode FROM workspace_notification_preferences WHERE user_id='u1' AND workspace_id='w1'").get().mode,"detailed");
 }finally{db.close();}
});
