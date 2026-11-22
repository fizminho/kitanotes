import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleInvitationsRequest } from "./invitations.ts";

class D1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of ["migrations/0001_initial.sql", "migrations/0002_sessions.sql", "migrations/0003_invitation_accept_trigger.sql","migrations/0004_calendar_reminders_notifications.sql","migrations/0005_shared_note_notifications.sql","migrations/0006_ai_consent_and_usage.sql", "migrations/0007_request_rate_limits.sql", "migrations/0008_push_subscriptions.sql","migrations/0009_notification_preferences.sql","migrations/0011_workspace_visibility.sql","migrations/0012_unified_workspace_type.sql"]) {
      this.sqlite.exec(readFileSync(new URL("../" + file, import.meta.url), "utf8"));
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
  async batch(statements) { const out=[]; for (const statement of statements) out.push(await statement.run()); return out; }
  close() { this.sqlite.close(); }
}

function seed() {
  const db = new D1TestDatabase();
  const now = new Date().toISOString();
  const users = [
    ["u1","sub1","owner@example.com"],
    ["u2","sub2","invitee@example.com"],
    ["u3","sub3","other@example.com"]
  ];
  for (const [id,sub,email] of users) db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)").run(id,sub,email,email,now,now);
  db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w1','Shared','u1','shared',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u3','viewer',?)").run(now);
  const tokens = { u1:"owner-session",u2:"invitee-session",u3:"other-session" };
  for (const [userId,token] of Object.entries(tokens)) {
    db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)").run("s-"+userId,userId,createHash("sha256").update(token).digest("base64url"),"2099-01-01T00:00:00.000Z",now);
  }
  return { db,env:{ DB:db,APP_BASE_URL:"https://kitanotes.test" },tokens };
}

function request(path,token,method="GET",body) {
  const headers = { cookie:"__Host-kitanotes_session="+token };
  const init = { method,headers };
  if (body !== undefined) {
    headers["content-type"]="application/json";
    headers.origin="https://kitanotes.test";
    init.body=JSON.stringify(body);
  }
  return new Request("https://kitanotes.test"+path,init);
}
const hashToken = token => createHash("sha256").update(token).digest("base64url");

test("owner creates one-time Gmail handoff invite and verified invitee accepts it", async () => {
  const {db,env,tokens}=seed();
  try {
    const created=await handleInvitationsRequest(request("/api/invitations",tokens.u1,"POST",{workspaceId:"w1",email:"Invitee@Example.com",role:"editor"}),env);
    assert.equal(created.status,201);
    const result=await created.json();
    assert.equal(result.invitation.email,"invitee@example.com");
    assert.equal(result.delivery,"manual_gmail_handoff");
    const invitationUrl=new URL(result.invitationUrl);
    const rawToken=invitationUrl.searchParams.get("token");
    assert.ok(rawToken && rawToken.length>=32);
    assert.equal(invitationUrl.pathname,"/invite/accept");
    assert.equal(result.gmailComposeUrl.includes("mail.google.com"),true);
    const stored=db.sqlite.prepare("SELECT token_hash,status FROM invitations WHERE id=?").get(result.invitation.id);
    assert.equal(stored.status,"pending");
    assert.equal(stored.token_hash,hashToken(rawToken));
    assert.notEqual(stored.token_hash,rawToken);

    const duplicate=await handleInvitationsRequest(request("/api/invitations",tokens.u1,"POST",{workspaceId:"w1",email:"invitee@example.com",role:"viewer"}),env);
    assert.equal(duplicate.status,409);

    const accepted=await handleInvitationsRequest(request("/api/invitations/accept",tokens.u2,"POST",{token:rawToken}),env);
    assert.equal(accepted.status,200);
    assert.deepEqual(await accepted.json(),{accepted:true,workspaceId:"w1",role:"editor"});
    assert.equal(db.sqlite.prepare("SELECT role FROM workspace_members WHERE workspace_id='w1' AND user_id='u2'").get().role,"editor");
    assert.equal(db.sqlite.prepare("SELECT status FROM invitations WHERE id=?").get(result.invitation.id).status,"accepted");

    const replay=await handleInvitationsRequest(request("/api/invitations/accept",tokens.u2,"POST",{token:rawToken}),env);
    assert.equal(replay.status,400);
  } finally { db.close(); }
});

test("invitation acceptance rejects a different verified Google email", async () => {
  const {db,env,tokens}=seed();
  try {
    const created=await handleInvitationsRequest(request("/api/invitations",tokens.u1,"POST",{workspaceId:"w1",email:"invitee@example.com",role:"viewer"}),env);
    const result=await created.json();
    const token=new URL(result.invitationUrl).searchParams.get("token");
    const mismatch=await handleInvitationsRequest(request("/api/invitations/accept",tokens.u3,"POST",{token}),env);
    assert.equal(mismatch.status,403);
    assert.equal(db.sqlite.prepare("SELECT status FROM invitations WHERE id=?").get(result.invitation.id).status,"pending");
  } finally { db.close(); }
});

test("only workspace owner can invite and revoke pending invitations", async () => {
  const {db,env,tokens}=seed();
  try {
    const denied=await handleInvitationsRequest(request("/api/invitations",tokens.u3,"POST",{workspaceId:"w1",email:"new@example.com",role:"viewer"}),env);
    assert.equal(denied.status,403);
    const created=await handleInvitationsRequest(request("/api/invitations",tokens.u1,"POST",{workspaceId:"w1",email:"new@example.com",role:"viewer"}),env);
    const result=await created.json();
    const revoked=await handleInvitationsRequest(request("/api/invitations/"+result.invitation.id,tokens.u1,"DELETE",{}),env);
    assert.equal(revoked.status,200);
    assert.equal(db.sqlite.prepare("SELECT status FROM invitations WHERE id=?").get(result.invitation.id).status,"revoked");
  } finally { db.close(); }
});

test("expired invitation is marked expired and cannot be accepted", async () => {
  const {db,env,tokens}=seed();
  try {
    const token="expired-invitation-token-value-1234567890";
    const hash=hashToken(token);
    const now=new Date().toISOString();
    db.sqlite.prepare("INSERT INTO invitations (id,workspace_id,invited_email_normalized,invited_by_user_id,role,token_hash,status,expires_at,created_at) VALUES ('expired1','w1','invitee@example.com','u1','viewer',?,'pending','2000-01-01T00:00:00.000Z',?)").run(hash,now);
    const response=await handleInvitationsRequest(request("/api/invitations/accept",tokens.u2,"POST",{token}),env);
    assert.equal(response.status,410);
    assert.equal(db.sqlite.prepare("SELECT status FROM invitations WHERE id='expired1'").get().status,"expired");
  } finally { db.close(); }
});

test("invitation creation is limited to ten per owner per hour", async () => {
  const { db, env, tokens } = seed();
  try {
    let last;
    for (let index = 0; index < 11; index++) {
      last = await handleInvitationsRequest(request("/api/invitations", tokens.u1, "POST", {
        workspaceId: "w1",
        email: "person" + index + "@example.com",
        role: "viewer"
      }), env);
      if (index < 10) assert.equal(last.status, 201);
    }
    assert.equal(last.status, 429);
    assert.equal(last.headers.get("retry-after") !== null, true);
    assert.equal(db.sqlite.prepare("SELECT request_count FROM request_rate_limits WHERE bucket_key='invitation:create:user:u1'").get().request_count, 10);
  } finally {
    db.close();
  }
});


test("workspace owner can list members, change permissions, and remove a member", async () => {
  const {db,env,tokens}=seed();
  try {
    const listed=await handleInvitationsRequest(request("/api/workspaces/w1/members",tokens.u1),env);
    assert.equal(listed.status,200);
    assert.equal((await listed.json()).members.length,2);
    const changed=await handleInvitationsRequest(request("/api/workspaces/w1/members/u3",tokens.u1,"PATCH",{role:"editor"}),env);
    assert.equal(changed.status,200);
    assert.equal(db.sqlite.prepare("SELECT role FROM workspace_members WHERE workspace_id='w1' AND user_id='u3'").get().role,"editor");
    const removed=await handleInvitationsRequest(request("/api/workspaces/w1/members/u3",tokens.u1,"DELETE",{}),env);
    assert.equal(removed.status,200);
    assert.equal(db.sqlite.prepare("SELECT user_id FROM workspace_members WHERE workspace_id='w1' AND user_id='u3'").get(),undefined);
  } finally { db.close(); }
});

test("making a shared workspace private removes members and revokes pending invitations without deleting notes", async () => {
  const {db,env,tokens}=seed();
  try {
    const now=new Date().toISOString();
    db.sqlite.prepare("INSERT INTO invitations (id,workspace_id,invited_email_normalized,invited_by_user_id,role,token_hash,status,expires_at,created_at) VALUES ('pending1','w1','new@example.com','u1','viewer','hash-pending','pending','2099-01-01T00:00:00.000Z',?)").run(now);
    db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n1','w1','Keep me','Body','u1',?,?)").run(now,now);
    const response=await handleInvitationsRequest(request("/api/workspaces/w1",tokens.u1,"PATCH",{action:"make_private"}),env);
    assert.equal(response.status,200);
    assert.equal(db.sqlite.prepare("SELECT visibility FROM workspaces WHERE id='w1'").get().visibility,"private");
    assert.equal(db.sqlite.prepare("SELECT workspace_type FROM workspaces WHERE id='w1'").get().workspace_type,"shared");
    assert.deepEqual(db.sqlite.prepare("SELECT user_id FROM workspace_members WHERE workspace_id='w1'").all().map(row=>row.user_id),["u1"]);
    assert.equal(db.sqlite.prepare("SELECT status FROM invitations WHERE id='pending1'").get().status,"revoked");
    assert.equal(db.sqlite.prepare("SELECT title FROM notes WHERE id='n1'").get().title,"Keep me");
    const listed=await handleInvitationsRequest(request("/api/workspaces",tokens.u1),env);
    const listedBody=await listed.json();
    assert.equal(listedBody.workspaces.find(item=>item.id==="w1").type,"shared");
    assert.equal(listedBody.workspaces.find(item=>item.id==="w1").visibility,"private");
    assert.equal(db.sqlite.prepare("SELECT workspace_type FROM workspaces WHERE id='w1'").get().workspace_type,"shared");
    const reShared=await handleInvitationsRequest(request("/api/workspaces/w1",tokens.u1,"PATCH",{action:"make_shared"}),env);
    assert.equal(reShared.status,200);
    assert.equal(db.sqlite.prepare("SELECT visibility FROM workspaces WHERE id='w1'").get().visibility,"shared");
    assert.equal(db.sqlite.prepare("SELECT workspace_type FROM workspaces WHERE id='w1'").get().workspace_type,"shared");
    const blocked=await handleInvitationsRequest(request("/api/invitations",tokens.u1,"POST",{workspaceId:"w1",email:"again@example.com",role:"viewer"}),env);
    assert.equal(blocked.status,409);
  } finally { db.close(); }
});

test("creating a workspace makes a shared space that can be invited to, renamed, left and deleted", async () => {
  const {db,env,tokens}=seed();
  try {
    const created=await handleInvitationsRequest(request("/api/workspaces",tokens.u1,"POST",{name:"Family"}),env);
    assert.equal(created.status,201);
    const {workspace}=await created.json();
    assert.equal(workspace.type,"shared");
    const invite=await handleInvitationsRequest(request("/api/invitations",tokens.u1,"POST",{workspaceId:workspace.id,email:"someone@example.com",role:"viewer"}),env);
    assert.equal(invite.status,201);
    const renamed=await handleInvitationsRequest(request("/api/workspaces/"+workspace.id,tokens.u1,"PATCH",{name:"Family HQ"}),env);
    assert.equal(renamed.status,200);
    assert.equal(db.sqlite.prepare("SELECT name FROM workspaces WHERE id=?").get(workspace.id).name,"Family HQ");
    const deleted=await handleInvitationsRequest(request("/api/workspaces/"+workspace.id,tokens.u1,"DELETE",{}),env);
    assert.equal(deleted.status,200);
    assert.equal(db.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(workspace.id),undefined);
  } finally { db.close(); }
});

test("accepting an invitation logs activity and notifies the owner; members can read members and activity", async () => {
  const {db,env,tokens}=seed();
  try {
    const created=await handleInvitationsRequest(request("/api/invitations",tokens.u1,"POST",{workspaceId:"w1",email:"invitee@example.com",role:"editor"}),env);
    const token=new URL((await created.json()).invitationUrl).searchParams.get("token");
    await handleInvitationsRequest(request("/api/invitations/accept",tokens.u2,"POST",{token}),env);
    const note=db.sqlite.prepare("SELECT title,notification_type FROM notifications WHERE user_id='u1'").get();
    assert.equal(note.notification_type,"invitation_accepted");
    const members=await handleInvitationsRequest(request("/api/workspaces/w1/members",tokens.u3),env);
    assert.equal(members.status,200);
    assert.equal((await members.json()).members.length,3);
    const activity=await handleInvitationsRequest(request("/api/workspaces/w1/activity",tokens.u3),env);
    assert.equal(activity.status,200);
    const types=(await activity.json()).activity.map(item=>item.type);
    assert.ok(types.includes("member.joined")&&types.includes("invitation.created"));
    const outsider=await handleInvitationsRequest(request("/api/workspaces/w1/activity","unknown-session"),env);
    assert.notEqual(outsider.status,200);
  } finally { db.close(); }
});

test("members can leave, owners can transfer ownership, role changes notify the member", async () => {
  const {db,env,tokens}=seed();
  try {
    const changed=await handleInvitationsRequest(request("/api/workspaces/w1/members/u3",tokens.u1,"PATCH",{role:"editor"}),env);
    assert.equal(changed.status,200);
    assert.equal(db.sqlite.prepare("SELECT notification_type FROM notifications WHERE user_id='u3'").get().notification_type,"member_role_changed");
    const denied=await handleInvitationsRequest(request("/api/workspaces/w1",tokens.u3,"PATCH",{action:"transfer_ownership",userId:"u3"}),env);
    assert.equal(denied.status,404);
    const moved=await handleInvitationsRequest(request("/api/workspaces/w1",tokens.u1,"PATCH",{action:"transfer_ownership",userId:"u3"}),env);
    assert.equal(moved.status,200);
    assert.equal(db.sqlite.prepare("SELECT owner_user_id FROM workspaces WHERE id='w1'").get().owner_user_id,"u3");
    assert.equal(db.sqlite.prepare("SELECT role FROM workspace_members WHERE workspace_id='w1' AND user_id='u1'").get().role,"editor");
    const left=await handleInvitationsRequest(request("/api/workspaces/w1/members/u1",tokens.u1,"DELETE",{}),env);
    assert.equal(left.status,200);
    assert.equal(db.sqlite.prepare("SELECT user_id FROM workspace_members WHERE workspace_id='w1' AND user_id='u1'").get(),undefined);
    const ownerLeave=await handleInvitationsRequest(request("/api/workspaces/w1/members/u3",tokens.u3,"DELETE",{}),env);
    assert.equal(ownerLeave.status,409);
  } finally { db.close(); }
});
