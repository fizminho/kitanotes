import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleAuthRequest } from "./auth.ts";

class D1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of ["migrations/0001_initial.sql", "migrations/0002_sessions.sql", "migrations/0003_invitation_accept_trigger.sql", "migrations/0004_calendar_reminders_notifications.sql", "migrations/0005_shared_note_notifications.sql", "migrations/0006_ai_consent_and_usage.sql", "migrations/0007_request_rate_limits.sql", "migrations/0008_push_subscriptions.sql","migrations/0009_notification_preferences.sql"]) {
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
  close() { this.sqlite.close(); }
}

const base64url = value => Buffer.from(value).toString("base64url");

test("Google callback creates user/workspace/session and logout revokes it", async () => {
  const db = new D1TestDatabase();
  const secret = "local-test-session-secret-with-more-than-32-characters";
  const state = "state-random-value";
  const nonce = "nonce-random-value";
  const verifier = "pkce-verifier-random-value";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 0x10001 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "google-test-key", alg: "RS256", use: "sig" };
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64url(JSON.stringify({ alg: "RS256", kid: "google-test-key" }));
  const jwtClaims = base64url(JSON.stringify({
    iss: "https://accounts.google.com", aud: "test-client-id", exp: now + 300, iat: now,
    nonce, sub: "google-sub-123", email: "person@example.com", email_verified: true, name: "Kita Tester"
  }));
  const signingInput = jwtHeader + "." + jwtClaims;
  const idToken = signingInput + "." + sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  const encodedState = base64url(JSON.stringify({ state, nonce, verifier, returnTo: "/invite/accept?token=invite-token-123", issuedAt: Date.now() }));
  const signature = createHmac("sha256", secret).update(encodedState).digest("base64url");
  const stateCookie = "__Host-kitanotes_oauth=" + encodedState + "." + signature;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("code"), "google-auth-code");
      assert.equal(form.get("code_verifier"), verifier);
      assert.equal(form.get("client_id"), "test-client-id");
      return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    throw new Error("Unexpected fetch URL: " + url);
  };

  try {
    const env = {
      DB: db,
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      SESSION_SECRET: secret,
      APP_BASE_URL: "https://kitanotes.test"
    };
    const callback = new Request("https://kitanotes.test/auth/google/callback?code=google-auth-code&state=" + state, {
      headers: { cookie: stateCookie }
    });
    const response = await handleAuthRequest(callback, env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://kitanotes.test/invite/accept?token=invite-token-123");
    const setCookie = response.headers.get("set-cookie") ?? "";
    const sessionMatch = setCookie.match(/__Host-kitanotes_session=([^;,]+)/);
    assert.ok(sessionMatch, "session cookie should be issued");

    const user = db.sqlite.prepare("SELECT id,email,display_name FROM users WHERE google_sub=?").get("google-sub-123");
    assert.equal(user.email, "person@example.com");
    assert.equal(user.display_name, "Kita Tester");
    const workspace = db.sqlite.prepare("SELECT id FROM workspaces WHERE owner_user_id=? AND workspace_type='personal'").get(user.id);
    assert.ok(workspace);
    assert.equal(db.sqlite.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").get(workspace.id,user.id).role, "owner");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id=?").get(user.id).count, 1);

    const me = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/me", {
      headers: { cookie: "__Host-kitanotes_session=" + sessionMatch[1] }
    }), env);
    assert.equal(me.status, 200);
    const mePayload = await me.json();
    assert.equal(mePayload.user.email, "person@example.com");
    assert.equal(mePayload.user.personalWorkspaceId, workspace.id);

    const loggedOut = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/logout", {
      method: "POST",
      headers: { cookie: "__Host-kitanotes_session=" + sessionMatch[1], origin: "https://kitanotes.test" }
    }), env);
    assert.equal(loggedOut.status, 200);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id=?").get(user.id).count, 0);
    const afterLogout = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/me", {
      headers: { cookie: "__Host-kitanotes_session=" + sessionMatch[1] }
    }), env);
    assert.equal(afterLogout.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Google login initiation is rate limited per IP fingerprint", async () => {
  const db = new D1TestDatabase();
  const env = {
    DB: db,
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters",
    APP_BASE_URL: "https://kitanotes.test"
  };
  try {
    let last;
    for (let index = 0; index < 11; index++) {
      last = await handleAuthRequest(new Request("https://kitanotes.test/auth/google", {
        headers: { "cf-connecting-ip": "203.0.113.10" }
      }), env);
    }
    assert.equal(last.status, 429);
    assert.equal(last.headers.get("retry-after") !== null, true);
    assert.equal(db.sqlite.prepare("SELECT request_count FROM request_rate_limits WHERE bucket_key LIKE 'oauth:start:%'").get().request_count, 10);
  } finally {
    db.close();
  }
});

test("Google OAuth callbacks are rate limited per IP fingerprint", async () => {
  const db = new D1TestDatabase();
  const env = {
    DB: db,
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters",
    APP_BASE_URL: "https://kitanotes.test"
  };
  try {
    let last;
    for (let index = 0; index < 21; index++) {
      last = await handleAuthRequest(new Request("https://kitanotes.test/auth/google/callback?error=access_denied", {
        headers: { "cf-connecting-ip": "203.0.113.11" }
      }), env);
      if (index < 20) assert.equal(last.status, 400);
    }
    assert.equal(last.status, 429);
    assert.equal(last.headers.get("retry-after") !== null, true);
    assert.equal(db.sqlite.prepare("SELECT request_count FROM request_rate_limits WHERE bucket_key LIKE 'oauth:callback:%'").get().request_count, 20);
  } finally {
    db.close();
  }
});
