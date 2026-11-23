import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleRemindersRequest } from "./reminders.ts";

const migrations = [
  "0001_initial.sql","0002_sessions.sql","0003_invitation_accept_trigger.sql",
  "0004_calendar_reminders_notifications.sql","0005_shared_note_notifications.sql",
  "0006_ai_consent_and_usage.sql","0007_request_rate_limits.sql","0008_push_subscriptions.sql",
  "0009_notification_preferences.sql","0010_gemini_ocr.sql","0011_workspace_visibility.sql",
  "0012_unified_workspace_type.sql","0013_content_audit_and_open_invites.sql",
  "0014_google_calendar_import.sql","0015_notification_activity_preferences.sql",
  "0016_calendar_2_0.sql","0017_calendar_holiday_cache.sql","0018_workspace_starred_default.sql"
];
class D1TestDatabase {
  constructor() {
    this.sqlite=new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for(const file of migrations)this.sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
  }
  prepare(sql) {
    const db=this.sqlite;
    return {bind(...values){return{
      first:async()=>db.prepare(sql).get(...values)??null,
      all:async()=>({results:db.prepare(sql).all(...values)}),
      run:async()=>{const r=db.prepare(sql).run(...values);return{meta:{changes:Number(r.changes)}};}
    };}};
  }
  close(){this.sqlite.close();}
}
function seed(){
  const db=new D1TestDatabase(),now=new Date().toISOString();
  for(const [id,email] of [["u1","owner@example.com"],["u2","viewer@example.com"],["u3","outsider@example.com"]]){
    db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)").run(id,"sub-"+id,email,email,now,now);
  }
  for(const [id,owner] of [["w1","u1"],["w2","u3"]]){
    db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES (?,?,?,'shared','private',?,?)").run(id,id,owner,now,now);
  }
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u2','viewer',?)").run(now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w2','u3','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n2','w2','Other workspace note','Private','u3',?,?)").run(now,now);
  const tokens={u1:"owner-session",u2:"viewer-session",u3:"outsider-session"};
  for(const [userId,token] of Object.entries(tokens)){
    db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)").run("s-"+userId,userId,createHash("sha256").update(token).digest("base64url"),"2099-01-01T00:00:00.000Z",now);
  }
  for(const [id,workspace,user,title] of [["r1","w1","u1","Workspace one"],["r2","w2","u3","Private reminder"]]){
    db.sqlite.prepare("INSERT INTO reminders (id,workspace_id,title,due_at_utc,timezone,status,idempotency_key,created_by_user_id,created_at,updated_at) VALUES (?,?,?,'2099-01-01T10:00:00.000Z','Asia/Kuala_Lumpur','pending',?,?,?,?)").run(id,workspace,title,"key-"+id,user,now,now);
  }
  return{db,env:{DB:db},tokens};
}
function request(path,token,method="GET",body){
  const headers={cookie:"__Host-kitanotes_session="+token};
  const init={method,headers};
  if(body!==undefined){headers["content-type"]="application/json";headers.origin="https://kitanotes.test";init.body=JSON.stringify(body);}
  return new Request("https://kitanotes.test"+path,init);
}

test("reminder listing is restricted to workspace membership and current user's workspaces",async()=>{
  const {db,env,tokens}=seed();
  try{
    const own=await handleRemindersRequest(request("/api/reminders",tokens.u1),env);
    assert.equal(own.status,200);
    assert.deepEqual((await own.json()).reminders.map(x=>x.id),["r1"]);
    const member=await handleRemindersRequest(request("/api/reminders?workspaceId=w1",tokens.u2),env);
    assert.equal(member.status,200);
    assert.deepEqual((await member.json()).reminders.map(x=>x.id),["r1"]);
    const outsider=await handleRemindersRequest(request("/api/reminders?workspaceId=w2",tokens.u1),env);
    assert.equal(outsider.status,404);
  }finally{db.close();}
});

test("viewer can read reminders but cannot cancel them; outsider cannot cancel by ID",async()=>{
  const {db,env,tokens}=seed();
  try{
    const viewerRead=await handleRemindersRequest(request("/api/reminders?workspaceId=w1",tokens.u2),env);
    assert.equal(viewerRead.status,200);
    const viewerDelete=await handleRemindersRequest(request("/api/reminders/r1",tokens.u2,"DELETE",{}),env);
    assert.equal(viewerDelete.status,403);
    const outsiderDelete=await handleRemindersRequest(request("/api/reminders/r1",tokens.u3,"DELETE",{}),env);
    assert.equal(outsiderDelete.status,404);
    assert.equal(db.sqlite.prepare("SELECT status FROM reminders WHERE id='r1'").get().status,"pending");
  }finally{db.close();}
});

test("reminder creation rejects cross-workspace links and non-editor roles",async()=>{
  const {db,env,tokens}=seed();
  try{
    const viewer=await handleRemindersRequest(request("/api/reminders",tokens.u2,"POST",{workspaceId:"w1",title:"Viewer reminder",dueAt:"2099-01-01T10:00:00Z"}),env);
    assert.equal(viewer.status,403);
    const cross=await handleRemindersRequest(request("/api/reminders",tokens.u1,"POST",{workspaceId:"w1",title:"Cross-link",dueAt:"2099-01-01T10:00:00Z",noteId:"n2"}),env);
    assert.equal(cross.status,400);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM reminders WHERE title IN ('Viewer reminder','Cross-link')").get().total,0);
  }finally{db.close();}
});

test("pending reminders can be edited by workspace editors and reject viewers or outsiders",async()=>{
  const {db,env,tokens}=seed();
  try{
    const viewer=await handleRemindersRequest(request("/api/reminders/r1",tokens.u2,"PATCH",{title:"Tampered",dueAt:"2099-01-02T10:00:00Z"}),env);
    assert.equal(viewer.status,403);
    const outsider=await handleRemindersRequest(request("/api/reminders/r1",tokens.u3,"PATCH",{title:"Tampered"}),env);
    assert.equal(outsider.status,404);
    const updated=await handleRemindersRequest(request("/api/reminders/r1",tokens.u1,"PATCH",{title:"Updated event",dueAt:"2099-01-02T10:00:00Z",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(updated.status,200);
    const body=await updated.json();
    assert.equal(body.reminder.title,"Updated event");
    assert.equal(body.reminder.dueAt,"2099-01-02T10:00:00.000Z");
    assert.equal(db.sqlite.prepare("SELECT status FROM reminders WHERE id='r1'").get().status,"pending");
  }finally{db.close();}
});

test("delivered reminders cannot be edited",async()=>{
  const {db,env,tokens}=seed();
  try{
    db.sqlite.prepare("UPDATE reminders SET status='delivered' WHERE id='r1'").run();
    const response=await handleRemindersRequest(request("/api/reminders/r1",tokens.u1,"PATCH",{title:"Late edit"}),env);
    assert.equal(response.status,409);
    assert.equal(db.sqlite.prepare("SELECT title FROM reminders WHERE id='r1'").get().title,"Workspace one");
  }finally{db.close();}
});
