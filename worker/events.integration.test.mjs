import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleEventsRequest } from "./events.ts";

const migrations = [
  "0001_initial.sql","0002_sessions.sql","0003_invitation_accept_trigger.sql",
  "0004_calendar_reminders_notifications.sql","0005_shared_note_notifications.sql",
  "0006_ai_consent_and_usage.sql","0007_request_rate_limits.sql","0008_push_subscriptions.sql",
  "0009_notification_preferences.sql","0010_gemini_ocr.sql","0011_workspace_visibility.sql",
  "0012_unified_workspace_type.sql","0013_content_audit_and_open_invites.sql",
  "0014_google_calendar_import.sql","0015_notification_activity_preferences.sql",
  "0016_calendar_2_0.sql","0017_calendar_holiday_cache.sql","0018_workspace_starred_default.sql","0025_workspace_membership_delta.sql"
];

class D1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of migrations) {
      this.sqlite.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
    }
  }
  prepare(sql) {
    const database = this.sqlite;
    return { bind(...values) {
      return {
        first: async () => database.prepare(sql).get(...values) ?? null,
        all: async () => ({ results: database.prepare(sql).all(...values) }),
        run: async () => {
          const result = database.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        }
      };
    }};
  }
  close() { this.sqlite.close(); }
}

function seed() {
  const db = new D1TestDatabase();
  const now = new Date().toISOString();
  for (const [id, email] of [["u1","owner@example.com"],["u2","viewer@example.com"],["u3","outsider@example.com"]]) {
    db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?, ?,1,?,?)")
      .run(id,"sub-"+id,email,email,now,now);
  }
  for (const [id, owner] of [["w1","u1"],["w2","u3"]]) {
    db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES (?,?,?,'shared','private',?,?)")
      .run(id,id,owner,now,now);
  }
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u2','viewer',?)").run(now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w2','u3','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n1','w1','Shared note','Body','u1',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n2','w2','Private note','Secret','u3',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO calendar_events (id,workspace_id,title,description,starts_at_utc,ends_at_utc,timezone,all_day,created_by_user_id,updated_by_user_id,version,created_at,updated_at) VALUES ('e1','w1','Shared event','','2026-11-23T10:00:00.000Z','2026-11-23T11:00:00.000Z','Asia/Kuala_Lumpur',0,'u1','u1',1,?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO calendar_events (id,workspace_id,title,description,starts_at_utc,ends_at_utc,timezone,all_day,created_by_user_id,updated_by_user_id,version,created_at,updated_at) VALUES ('e2','w2','Private event','','2026-11-23T10:00:00.000Z','2026-11-23T11:00:00.000Z','Asia/Kuala_Lumpur',0,'u3','u3',1,?,?)").run(now,now);
  const tokens = {u1:"owner-session",u2:"viewer-session",u3:"outsider-session"};
  for (const [userId, token] of Object.entries(tokens)) {
    db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
      .run("s-"+userId,userId,createHash("sha256").update(token).digest("base64url"),"2099-01-01T00:00:00.000Z",now);
  }
  return {db,env:{DB:db},tokens};
}

function request(path, token, method="GET", body) {
  const headers = {cookie:"__Host-kitanotes_session="+token};
  const init = {method,headers};
  if (body !== undefined) {
    headers["content-type"]="application/json";
    headers.origin="https://kitanotes.test";
    init.body=JSON.stringify(body);
  }
  return new Request("https://kitanotes.test"+path,init);
}

test("event list and detail are isolated to current workspace memberships", async () => {
  const {db,env,tokens}=seed();
  try {
    const list=await handleEventsRequest(request("/api/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z",tokens.u1),env);
    assert.equal(list.status,200);
    const listBody=await list.json();
    assert.deepEqual(listBody.events.map(event=>event.id),["e1"]);
    assert.equal("createdByEmail" in listBody.events[0],false);
    assert.equal("updatedByEmail" in listBody.events[0],false);

    const outsiderDetail=await handleEventsRequest(request("/api/events/e1",tokens.u3),env);
    assert.equal(outsiderDetail.status,404);
    const crossWorkspaceDetail=await handleEventsRequest(request("/api/events/e2",tokens.u1),env);
    assert.equal(crossWorkspaceDetail.status,404);
    const unauthorizedWorkspaceList=await handleEventsRequest(request("/api/events?workspaceId=w2",tokens.u1),env);
    assert.equal(unauthorizedWorkspaceList.status,404);
  } finally { db.close(); }
});

test("workspace viewer can read events but cannot create, update, or delete them", async () => {
  const {db,env,tokens}=seed();
  try {
    const read=await handleEventsRequest(request("/api/events/e1",tokens.u2),env);
    assert.equal(read.status,200);

    const create=await handleEventsRequest(request("/api/events",tokens.u2,"POST",{
      workspaceId:"w1",title:"Viewer write",startsAt:"2026-11-24T10:00:00Z",endsAt:"2026-11-24T11:00:00Z"
    }),env);
    assert.equal(create.status,403);

    const update=await handleEventsRequest(request("/api/events/e1",tokens.u2,"PATCH",{version:1,title:"Tampered"}),env);
    assert.equal(update.status,403);
    const remove=await handleEventsRequest(request("/api/events/e1",tokens.u2,"DELETE",{version:1}),env);
    assert.equal(remove.status,403);
    assert.equal(db.sqlite.prepare("SELECT title,deleted_at FROM calendar_events WHERE id='e1'").get().title,"Shared event");
  } finally { db.close(); }
});

test("removed workspace member immediately loses event list and detail access", async () => {
  const {db,env,tokens}=seed();
  try {
    const before=await handleEventsRequest(request("/api/events/e1",tokens.u2),env);
    assert.equal(before.status,200);
    db.sqlite.prepare("DELETE FROM workspace_members WHERE workspace_id='w1' AND user_id='u2'").run();

    const detail=await handleEventsRequest(request("/api/events/e1",tokens.u2),env);
    assert.equal(detail.status,404);
    const list=await handleEventsRequest(request("/api/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z",tokens.u2),env);
    assert.equal(list.status,200);
    assert.deepEqual((await list.json()).events,[]);
  } finally { db.close(); }
});

test("event creation rejects a workspace the caller does not belong to", async () => {
  const {db,env,tokens}=seed();
  try {
    const response=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{
      workspaceId:"w2",title:"Cross-workspace injection",startsAt:"2026-11-24T10:00:00Z",endsAt:"2026-11-24T11:00:00Z"
    }),env);
    assert.equal(response.status,403);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM calendar_events WHERE title='Cross-workspace injection'").get().total,0);
  } finally { db.close(); }
});


test("event create and update reject linked notes from another workspace", async () => {
  const {db,env,tokens}=seed();
  try {
    const create=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{
      workspaceId:"w1",title:"Cross-workspace linked note",startsAt:"2026-11-24T10:00:00Z",endsAt:"2026-11-24T11:00:00Z",linkedNoteId:"n2"
    }),env);
    assert.equal(create.status,400);
    assert.equal((await create.json()).error,"INVALID_LINKED_NOTE");
    const update=await handleEventsRequest(request("/api/events/e1",tokens.u1,"PATCH",{
      version:1,linkedNoteId:"n2"
    }),env);
    assert.equal(update.status,409);
    assert.equal((await update.json()).error,"INVALID_OR_STALE_EVENT");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM calendar_events WHERE title='Cross-workspace linked note'").get().total,0);
    assert.equal(db.sqlite.prepare("SELECT linked_note_id,version FROM calendar_events WHERE id='e1'").get().linked_note_id,null);
  } finally { db.close(); }
});

test("aggregate event delta removes workspaces after membership revocation", async () => {
  const {db,env,tokens}=seed();
  try {
    const since=new Date(Date.now()-60000).toISOString();
    const before=await handleEventsRequest(request("/api/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z",tokens.u2),env);
    assert.equal(before.status,200);
    assert.deepEqual((await before.json()).events.map(event=>event.id),["e1"]);
    db.sqlite.prepare("DELETE FROM workspace_members WHERE workspace_id='w1' AND user_id='u2'").run();
    const delta=await handleEventsRequest(request("/api/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z&updatedSince="+encodeURIComponent(since),tokens.u2),env);
    assert.equal(delta.status,200);
    const body=await delta.json();
    assert.deepEqual(body.removedWorkspaceIds,["w1"]);
  } finally { db.close(); }
});

test("event creation requires an explicit workspace and never falls back to personal",async()=>{
  const {db,env,tokens}=seed();
  try{
    const response=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{
      title:"Missing workspace selection",startsAt:"2026-11-24T10:00:00Z",endsAt:"2026-11-24T11:00:00Z"
    }),env);
    assert.equal(response.status,400);
    assert.equal((await response.json()).error,"WORKSPACE_REQUIRED");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM calendar_events WHERE title='Missing workspace selection'").get().total,0);
  }finally{db.close();}
});
