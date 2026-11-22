import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleEventsRequest } from "./events.ts";
import { handleRemindersRequest } from "./reminders.ts";
import { handleNotificationsRequest } from "./notifications.ts";
import { deliverDueReminders } from "./reminder-cron.ts";

class D1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of ["migrations/0001_initial.sql","migrations/0002_sessions.sql","migrations/0003_invitation_accept_trigger.sql","migrations/0004_calendar_reminders_notifications.sql","migrations/0005_shared_note_notifications.sql"]) {
      this.sqlite.exec(readFileSync(new URL("../"+file,import.meta.url),"utf8"));
    }
  }
  prepare(sql) {
    const database=this.sqlite;
    return { bind(...values) {
      return {
        first:async()=>database.prepare(sql).get(...values)??null,
        all:async()=>({results:database.prepare(sql).all(...values)}),
        run:async()=>{const result=database.prepare(sql).run(...values);return{meta:{changes:Number(result.changes)}};}
      };
    }};
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results=[];
      for(const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch(error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close(){this.sqlite.close();}
}
function seed(){
  const db=new D1TestDatabase();const now=new Date().toISOString();
  for(const [id,sub,email] of [["u1","sub1","one@example.com"],["u2","sub2","two@example.com"],["u3","sub3","three@example.com"]])
    db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)").run(id,sub,email,email,now,now);
  for(const [id,owner] of [["w1","u1"],["w2","u2"],["w3","u3"]])
    db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES (?,?,?,'personal',?,?)").run(id,id,owner,now,now);
  for(const [workspace,user,role] of [["w1","u1","owner"],["w1","u2","viewer"],["w2","u2","owner"],["w3","u3","owner"]])
    db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)").run(workspace,user,role,now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n1','w1','Note one','Body','u1',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n2','w2','Note two','Private','u2',?,?)").run(now,now);
  const tokens={u1:"calendar-session-1",u2:"calendar-session-2",u3:"calendar-session-3"};
  for(const [user,token] of Object.entries(tokens))
    db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)").run("s-"+user,user,createHash("sha256").update(token).digest("base64url"),"2099-01-01T00:00:00.000Z",now);
  return{db,env:{DB:db},tokens};
}
function request(path,token,method="GET",body){
  const headers={cookie:"__Host-kitanotes_session="+token};
  const init={method,headers};
  if(method!=="GET")headers.origin="https://kitanotes.test";
  if(body!==undefined){headers["content-type"]="application/json";init.body=JSON.stringify(body);}
  return new Request("https://kitanotes.test"+path,init);
}

test("calendar events store UTC instants, retain timezone and enforce workspace roles",async()=>{
  const{db,env,tokens}=seed();
  try{
    const created=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{title:"School meeting",description:"Meet teacher",startsAt:"2026-11-23T09:00:00+08:00",endsAt:"2026-11-23T10:00:00+08:00",timezone:"Asia/Kuala_Lumpur",linkedNoteId:"n1"}),env);
    assert.equal(created.status,201);
    const event=(await created.json()).event;
    assert.equal(event.startsAt,"2026-11-23T01:00:00.000Z");
    assert.equal(event.timezone,"Asia/Kuala_Lumpur");
    const range=await handleEventsRequest(request("/api/events?from=2026-11-23T00:00:00Z&to=2026-11-24T00:00:00Z",tokens.u1),env);
    assert.equal((await range.json()).events.length,1);
    const outsider=await handleEventsRequest(request("/api/events/"+event.id,tokens.u3),env);
    assert.equal(outsider.status,404);
    const viewerEdit=await handleEventsRequest(request("/api/events/"+event.id,tokens.u2,"PATCH",{version:1,title:"No access"}),env);
    assert.equal(viewerEdit.status,403);
    const wrongLink=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{title:"Bad link",startsAt:"2026-11-23T09:00:00+08:00",endsAt:"2026-11-23T10:00:00+08:00",timezone:"Asia/Kuala_Lumpur",linkedNoteId:"n2"}),env);
    assert.equal(wrongLink.status,400);
  }finally{db.close();}
});

test("event deletion cancels linked pending reminders",async()=>{
  const{db,env,tokens}=seed();
  try{
    const created=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{title:"Appointment",startsAt:"2026-11-23T09:00:00+08:00",endsAt:"2026-11-23T10:00:00+08:00",timezone:"Asia/Kuala_Lumpur"}),env);
    const event=(await created.json()).event;
    const reminder=await handleRemindersRequest(request("/api/reminders",tokens.u1,"POST",{workspaceId:"w1",eventId:event.id,title:"Leave home",dueAt:"2026-11-23T08:00:00+08:00",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(reminder.status,201);
    const reminderId=(await reminder.json()).reminder.id;
    const deleted=await handleEventsRequest(request("/api/events/"+event.id,tokens.u1,"DELETE",{version:1}),env);
    assert.equal(deleted.status,200);
    assert.equal(db.sqlite.prepare("SELECT status FROM reminders WHERE id=?").get(reminderId).status,"cancelled");
    const viewerCreate=await handleRemindersRequest(request("/api/reminders",tokens.u2,"POST",{workspaceId:"w1",title:"No access",dueAt:"2026-11-23T08:00:00+08:00",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(viewerCreate.status,403);
  }finally{db.close();}
});

test("cron delivers idempotent in-app reminders to workspace members",async()=>{
  const{db,env,tokens}=seed();
  try{
    const now=new Date().toISOString();
    db.sqlite.prepare("INSERT INTO reminders (id,workspace_id,title,due_at_utc,timezone,status,idempotency_key,created_by_user_id,created_at,updated_at) VALUES ('r1','w1','Pay school fee',?,'Asia/Kuala_Lumpur','pending','idem-r1','u1',?,?)").run(new Date(Date.now()-60000).toISOString(),now,now);
    const delivered=await deliverDueReminders(db);
    assert.equal(delivered,1);
    assert.equal(db.sqlite.prepare("SELECT status FROM reminders WHERE id='r1'").get().status,"delivered");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notifications WHERE workspace_id='w1' AND notification_type='reminder'").get().count,2);
    assert.equal(await deliverDueReminders(db),0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notifications WHERE workspace_id='w1' AND notification_type='reminder'").get().count,2);

    const inbox=await handleNotificationsRequest(request("/api/notifications",tokens.u1),env);
    const inboxPayload=await inbox.json();
    assert.equal(inboxPayload.notifications.length,1);
    assert.equal(inboxPayload.unreadCount,1);
    const readAll=await handleNotificationsRequest(request("/api/notifications/read-all",tokens.u1,"POST"),env);
    assert.equal(readAll.status,200);
    const afterRead=await handleNotificationsRequest(request("/api/notifications?unreadOnly=1",tokens.u1),env);
    assert.equal((await afterRead.json()).unreadCount,0);
    const otherUser=await handleNotificationsRequest(request("/api/notifications",tokens.u3),env);
    assert.equal((await otherUser.json()).notifications.length,0);
  }finally{db.close();}
});

test("cron cancels due reminders whose linked note was deleted",async()=>{
  const{db}=seed();
  try{
    const now=new Date().toISOString();
    db.sqlite.prepare("INSERT INTO reminders (id,workspace_id,note_id,title,due_at_utc,timezone,status,idempotency_key,created_by_user_id,created_at,updated_at) VALUES ('r2','w1','n1','Old note reminder',?,'Asia/Kuala_Lumpur','pending','idem-r2','u1',?,?)").run(new Date(Date.now()-60000).toISOString(),now,now);
    db.sqlite.prepare("UPDATE notes SET deleted_at=? WHERE id='n1'").run(now);
    assert.equal(await deliverDueReminders(db),0);
    assert.equal(db.sqlite.prepare("SELECT status FROM reminders WHERE id='r2'").get().status,"cancelled");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notifications WHERE resource_id='n1' AND notification_type='reminder'").get().count,0);
  }finally{db.close();}
});
