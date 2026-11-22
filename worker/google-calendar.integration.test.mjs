import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleGoogleCalendarRequest } from "./google-calendar.ts";
import { handleEventsRequest } from "./events.ts";

class D1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    const migrations = [
      "0001_initial.sql","0002_sessions.sql","0003_invitation_accept_trigger.sql","0004_calendar_reminders_notifications.sql",
      "0005_shared_note_notifications.sql","0006_ai_consent_and_usage.sql","0007_request_rate_limits.sql","0008_push_subscriptions.sql",
      "0009_notification_preferences.sql","0011_workspace_visibility.sql","0012_unified_workspace_type.sql",
      "0013_content_audit_and_open_invites.sql","0014_google_calendar_import.sql"
    ];
    for (const file of migrations) this.sqlite.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
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

test("Google Calendar imports incrementally into KitaNotes and imported events are read-only", async () => {
  const db = new D1TestDatabase();
  const session = "test-session-token-with-enough-randomness";
  const sessionHash = createHash("sha256").update(session).digest("base64url");
  const now = new Date().toISOString();
  const userId = "user-google-calendar";
  const workspaceId = "workspace-google-calendar";
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,display_name,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)")
    .run(userId,"google-sub-calendar","calendar@example.com","calendar@example.com","Calendar Tester",now,now);
  db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES (?,?,?,'shared','private',?,?)")
    .run(workspaceId,"Personal",userId,now,now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)")
    .run(workspaceId,userId,"owner",now);
  db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
    .run("session-id",userId,sessionHash,new Date(Date.now()+3600000).toISOString(),now);
  const env = {
    DB: db,
    GOOGLE_CLIENT_ID: "calendar-client-id",
    GOOGLE_CLIENT_SECRET: "calendar-client-secret",
    SESSION_SECRET: "a-session-secret-with-more-than-thirty-two-characters-for-tests",
    APP_BASE_URL: "https://kitanotes.test"
  };
  const originalFetch = globalThis.fetch;
  let syncCount = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(init.body);
      if (form.get("grant_type") === "authorization_code") {
        assert.equal(form.get("redirect_uri"), "https://kitanotes.test/auth/google/calendar/callback");
        return new Response(JSON.stringify({
          access_token: "initial-access-token",
          refresh_token: "encrypted-refresh-token-source",
          scope: "https://www.googleapis.com/auth/calendar.events.readonly",
          expires_in: 3600
        }), { status: 200 });
      }
      assert.equal(form.get("grant_type"), "refresh_token");
      return new Response(JSON.stringify({ access_token: "refreshed-access-token", expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")) {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer refreshed-access-token");
      const parsed = new URL(url);
      if (syncCount > 0) assert.equal(parsed.searchParams.get("syncToken"), "sync-cursor-" + syncCount);
      syncCount++;
      const title = syncCount === 1 ? "Imported appointment" : "Updated appointment";
      return new Response(JSON.stringify({
        items: [{ id: "google-event-1", status: "confirmed", summary: title, description: "From Google",
          start: { dateTime: "2026-11-24T09:00:00+08:00", timeZone: "Asia/Kuala_Lumpur" },
          end: { dateTime: "2026-11-24T10:00:00+08:00", timeZone: "Asia/Kuala_Lumpur" },
          created: "2026-11-20T10:00:00.000Z", creator: { email: "organizer@example.com", displayName: "Google Organizer" }, updated: "2026-11-22T10:00:00.000Z" },
          ...(syncCount === 1 ? [{ id: "google-all-day", status: "confirmed", summary: "All-day event", start: { date: "2026-11-25" }, end: { date: "2026-11-26" }, created: "2026-11-20T10:00:00.000Z", updated: "2026-11-22T10:00:00.000Z" }] : [])],
        nextSyncToken: "sync-cursor-" + syncCount
      }), { status: 200 });
    }
    throw new Error("Unexpected fetch URL: " + url);
  };

  try {
    const cookie = "__Host-kitanotes_session=" + session;
    const start = await handleGoogleCalendarRequest(new Request("https://kitanotes.test/auth/google/calendar/connect?workspaceId=" + workspaceId, { headers: { cookie } }), env);
    assert.equal(start.status, 302);
    const authorize = new URL(start.headers.get("location"));
    assert.ok(authorize.searchParams.get("scope").includes("calendar.events.readonly"));
    const state = authorize.searchParams.get("state");
    const callback = await handleGoogleCalendarRequest(new Request("https://kitanotes.test/auth/google/calendar/callback?code=auth-code&state=" + state, { headers: { cookie } }), env);
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get("location")).searchParams.get("googleCalendar"), "connected");
    const connection = db.sqlite.prepare("SELECT refresh_token_ciphertext,sync_token FROM google_calendar_connections WHERE user_id=? AND workspace_id=?").get(userId,workspaceId);
    assert.ok(connection.refresh_token_ciphertext);
    assert.equal(connection.sync_token, null);
    assert.notEqual(connection.refresh_token_ciphertext, "encrypted-refresh-token-source");

    const syncRequest = () => new Request("https://kitanotes.test/api/google-calendar/sync", {
      method: "POST", headers: { cookie, origin: "https://kitanotes.test", "content-type": "application/json" },
      body: JSON.stringify({ workspaceId })
    });
    const firstSync = await handleGoogleCalendarRequest(syncRequest(), env);
    assert.equal(firstSync.status, 200);
    const firstPayload = await firstSync.json();
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.imported, 2);
    assert.equal(firstPayload.updated, 0);
    assert.equal(firstPayload.deleted, 0);
    assert.equal(firstPayload.skipped, 0);
    assert.equal(firstPayload.reset, false);
    const firstEvent = db.sqlite.prepare("SELECT id,title,created_by_user_id,updated_by_user_id,source_created_by,source_created_at,source_updated_by,source_updated_at FROM calendar_events WHERE workspace_id=?").get(workspaceId);
    assert.equal(firstEvent.title, "Imported appointment");
    assert.equal(firstEvent.created_by_user_id, userId);
    assert.equal(firstEvent.updated_by_user_id, userId);
    assert.equal(firstEvent.source_created_by, "Google Organizer");
    assert.equal(firstEvent.source_created_at, "2026-11-20T10:00:00.000Z");
    assert.equal(firstEvent.source_updated_by, "Google Calendar");
    const allDay = db.sqlite.prepare("SELECT starts_at_utc,ends_at_utc,all_day FROM calendar_events WHERE workspace_id=? AND title=?").get(workspaceId,"All-day event");
    assert.equal(allDay.all_day, 1);
    assert.equal(allDay.starts_at_utc, "2026-11-24T16:00:00.000Z");
    assert.equal(allDay.ends_at_utc, "2026-11-25T15:59:59.999Z");

    const secondSync = await handleGoogleCalendarRequest(syncRequest(), env);
    assert.equal(secondSync.status, 200);
    const secondPayload = await secondSync.json();
    assert.equal(secondPayload.updated, 1);
    assert.equal(db.sqlite.prepare("SELECT title FROM calendar_events WHERE id=?").get(firstEvent.id).title, "Updated appointment");

    const edit = await handleEventsRequest(new Request("https://kitanotes.test/api/events/" + firstEvent.id, {
      method: "PATCH", headers: { cookie, origin: "https://kitanotes.test", "content-type": "application/json" },
      body: JSON.stringify({ version: 2, title: "Local overwrite" })
    }), env);
    assert.equal(edit.status, 403);
    assert.equal((await edit.json()).error, "GOOGLE_IMPORTED_EVENT_READ_ONLY");
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
