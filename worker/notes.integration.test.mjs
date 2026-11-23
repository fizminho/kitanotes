import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleNotesRequest } from "./notes.ts";

class D1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of ["migrations/0001_initial.sql", "migrations/0002_sessions.sql", "migrations/0003_invitation_accept_trigger.sql", "migrations/0004_calendar_reminders_notifications.sql", "migrations/0005_shared_note_notifications.sql","migrations/0006_ai_consent_and_usage.sql", "migrations/0007_request_rate_limits.sql", "migrations/0008_push_subscriptions.sql","migrations/0009_notification_preferences.sql","migrations/0011_workspace_visibility.sql","migrations/0012_unified_workspace_type.sql","migrations/0013_content_audit_and_open_invites.sql", "migrations/0014_google_calendar_import.sql","migrations/0015_notification_activity_preferences.sql"]) {
      this.sqlite.exec(readFileSync(new URL("../" + file, import.meta.url), "utf8"));
    }
  }
  prepare(sql) {
    const database = this.sqlite;
    return {
      bind(...values) {
        return {
          first: async () => database.prepare(sql).get(...values) ?? null,
          all: async () => ({ results: database.prepare(sql).all(...values) }),
          run: async () => {
            const result = database.prepare(sql).run(...values);
            return { meta: { changes: Number(result.changes) } };
          }
        };
      }
    };
  }
  close() { this.sqlite.close(); }
}

function seed() {
  const db = new D1TestDatabase();
  const now = new Date().toISOString();
  for (const [id, sub, email] of [
    ["u1", "sub-1", "one@example.com"],
    ["u2", "sub-2", "two@example.com"],
    ["u3", "sub-3", "three@example.com"]
  ]) db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)").run(id,sub,email,email,now,now);
  for (const [id, owner] of [["w1","u1"],["w2","u2"],["w3","u3"]]) db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES (?,?,?,'shared','private',?,?)").run(id,id,owner,now,now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u2','viewer',?)").run(now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w2','u2','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w3','u3','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO categories (id,workspace_id,name,created_by_user_id,created_at,updated_at) VALUES ('c2','w2','Private','u2',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n1','w1','Shared note','Only for members','u1',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n2','w2','Private note','Not for u1','u2',?,?)").run(now,now);
  const tokens = { u1: "session-one", u2: "session-two", u3: "session-three" };
  for (const [userId, token] of Object.entries(tokens)) {
    const hash = createHash("sha256").update(token).digest("base64url");
    db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)").run("s-" + userId,userId,hash,"2099-01-01T00:00:00.000Z",now);
  }
  return { db, env: { DB: db }, tokens };
}

function request(path, token, method = "GET", body) {
  const headers = { cookie: "__Host-kitanotes_session=" + token };
  const init = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers.origin = "https://kitanotes.test";
    init.body = JSON.stringify(body);
  }
  return new Request("https://kitanotes.test" + path, init);
}

test("notes list and detail enforce workspace membership isolation", async () => {
  const { db, env, tokens } = seed();
  try {
    const list = await handleNotesRequest(request("/api/notes", tokens.u1), env);
    assert.equal(list.status, 200);
    const ids = (await list.json()).notes.map(note => note.id);
    assert.deepEqual(ids, ["n1"]);
    const privateNote = await handleNotesRequest(request("/api/notes/n2", tokens.u1), env);
    assert.equal(privateNote.status, 404);
    const outsider = await handleNotesRequest(request("/api/notes/n1", tokens.u3), env);
    assert.equal(outsider.status, 404);
  } finally { db.close(); }
});

test("viewer can read but cannot modify a shared note", async () => {
  const { db, env, tokens } = seed();
  try {
    const read = await handleNotesRequest(request("/api/notes/n1", tokens.u2), env);
    assert.equal(read.status, 200);
    const update = await handleNotesRequest(request("/api/notes/n1", tokens.u2, "PATCH", { title: "Nope", version: 1 }), env);
    assert.equal(update.status, 403);
  } finally { db.close(); }
});

test("note creation rejects cross-workspace access and category assignment", async () => {
  const { db, env, tokens } = seed();
  try {
    const defaultWorkspace = await handleNotesRequest(request("/api/notes", tokens.u1, "POST", { title: "Default workspace note", content: "Uses private workspace" }), env);
    assert.equal(defaultWorkspace.status, 201);
    const createdNote=(await defaultWorkspace.json()).note;
    assert.equal(createdNote.workspaceId,"w1");
    assert.equal(createdNote.createdBy,"u1");
    assert.equal(createdNote.updatedBy,"u1");
    assert.ok(createdNote.createdAt&&createdNote.updatedAt);
    const wrongWorkspace = await handleNotesRequest(request("/api/notes", tokens.u1, "POST", { title: "Bad", content: "", workspaceId: "w2" }), env);
    assert.equal(wrongWorkspace.status, 403);
    const wrongCategory = await handleNotesRequest(request("/api/notes", tokens.u1, "POST", { title: "Bad", content: "", workspaceId: "w1", categoryId: "c2" }), env);
    assert.equal(wrongCategory.status, 400);
  } finally { db.close(); }
});

test("note updates use optimistic versioning and archive filter", async () => {
  const { db, env, tokens } = seed();
  try {
    const stale = await handleNotesRequest(request("/api/notes/n1", tokens.u1, "PATCH", { title: "Stale", version: 99 }), env);
    assert.equal(stale.status, 409);
    const archived = await handleNotesRequest(request("/api/notes/n1", tokens.u1, "PATCH", { version: 1, archived: true }), env);
    assert.equal(archived.status, 200);
    const auditNote=(await archived.json()).note;
    assert.equal(auditNote.createdBy,"u1");
    assert.equal(auditNote.updatedBy,"u1");
    assert.ok(auditNote.createdAt&&auditNote.updatedAt);
    assert.equal(db.sqlite.prepare("SELECT event_type FROM activity_events WHERE target_type='note' AND target_id='n1' ORDER BY created_at DESC LIMIT 1").get().event_type,"note.updated");
    const active = await handleNotesRequest(request("/api/notes", tokens.u1), env);
    assert.deepEqual((await active.json()).notes, []);
    const archiveList = await handleNotesRequest(request("/api/notes?archived=1", tokens.u1), env);
    assert.deepEqual((await archiveList.json()).notes.map(note => note.id), ["n1"]);
  } finally { db.close(); }
});

test("mutations require same-origin Origin header", async () => {
  const { db, env, tokens } = seed();
  try {
    const response = await handleNotesRequest(new Request("https://kitanotes.test/api/notes", {
      method: "POST",
      headers: { cookie: "__Host-kitanotes_session=" + tokens.u1, "content-type": "application/json", origin: "https://attacker.test" },
      body: JSON.stringify({ title: "CSRF", content: "" })
    }), env);
    assert.equal(response.status, 403);
  } finally { db.close(); }
});

test("category management is workspace-scoped and viewers cannot create categories", async () => {
  const { db, env, tokens } = seed();
  try {
    const created = await handleNotesRequest(request("/api/categories", tokens.u1, "POST", { name: "Work", color: "#6658d9", sortOrder: 2 }), env);
    assert.equal(created.status, 201);
    const list = await handleNotesRequest(request("/api/categories", tokens.u1), env);
    assert.equal((await list.json()).categories[0].name, "Work");
    const viewerCreate = await handleNotesRequest(request("/api/categories", tokens.u2, "POST", { name: "No access", workspaceId: "w1" }), env);
    assert.equal(viewerCreate.status, 403);
    const outsiderRead = await handleNotesRequest(request("/api/categories?workspaceId=w1", tokens.u3), env);
    assert.equal(outsiderRead.status, 404);
  } finally { db.close(); }
});

test("note delete is soft and removes the note from normal reads", async () => {
  const { db, env, tokens } = seed();
  try {
    const deleted = await handleNotesRequest(request("/api/notes/n1", tokens.u1, "DELETE", {}), env);
    assert.equal(deleted.status, 200);
    const detail = await handleNotesRequest(request("/api/notes/n1", tokens.u1), env);
    assert.equal(detail.status, 404);
    const row = db.sqlite.prepare("SELECT deleted_at FROM notes WHERE id='n1'").get();
    assert.ok(row.deleted_at);
  } finally { db.close(); }
});

test("new shared notes create in-app notifications for other workspace members", async () => {
  const { db, env, tokens } = seed();
  try {
    const created = await handleNotesRequest(request("/api/notes", tokens.u1, "POST", { title: "New shared idea", content: "Visible to workspace members", workspaceId: "w1" }), env);
    assert.equal(created.status, 201);
    const note = (await created.json()).note;
    const recipient = db.sqlite.prepare("SELECT notification_type,title,body,resource_id FROM notifications WHERE user_id='u2' AND resource_id=?").get(note.id);
    assert.equal(recipient.notification_type, "shared_note");
    assert.equal(recipient.title, "New note shared with you");
    assert.equal(recipient.body, "New shared idea");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id='u1' AND resource_id=?").get(note.id).count, 0);
  } finally { db.close(); }
});


test("viewer cannot delete a shared note and removed members immediately lose access", async () => {
  const { db, env, tokens } = seed();
  try {
    const viewerDelete = await handleNotesRequest(request("/api/notes/n1", tokens.u2, "DELETE", {}), env);
    assert.equal(viewerDelete.status, 403);
    assert.equal(db.sqlite.prepare("SELECT deleted_at FROM notes WHERE id='n1'").get().deleted_at, null);

    db.sqlite.prepare("DELETE FROM workspace_members WHERE workspace_id='w1' AND user_id='u2'").run();
    const removedMemberRead = await handleNotesRequest(request("/api/notes/n1", tokens.u2), env);
    assert.equal(removedMemberRead.status, 404);
    const removedMemberUpdate = await handleNotesRequest(request("/api/notes/n1", tokens.u2, "PATCH", { title: "Still here?", version: 1 }), env);
    assert.equal(removedMemberUpdate.status, 404);
    const removedMemberDelete = await handleNotesRequest(request("/api/notes/n1", tokens.u2, "DELETE", {}), env);
    assert.equal(removedMemberDelete.status, 404);
  } finally { db.close(); }
});
