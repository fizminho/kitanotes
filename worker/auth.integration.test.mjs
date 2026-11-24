import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleAuthRequest, commitPasskeyStepUp } from "./auth.ts";

class D1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of ["migrations/0001_initial.sql", "migrations/0002_sessions.sql", "migrations/0003_invitation_accept_trigger.sql", "migrations/0004_calendar_reminders_notifications.sql", "migrations/0005_shared_note_notifications.sql", "migrations/0006_ai_consent_and_usage.sql", "migrations/0007_request_rate_limits.sql", "migrations/0008_push_subscriptions.sql","migrations/0009_notification_preferences.sql","migrations/0011_workspace_visibility.sql","migrations/0012_unified_workspace_type.sql","migrations/0013_content_audit_and_open_invites.sql", "migrations/0014_google_calendar_import.sql", "migrations/0019_passkeys.sql", "migrations/0020_passkey_signup_recovery.sql", "migrations/0021_passkey_step_up.sql"]) {
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
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results=[];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

const base64url = value => Buffer.from(value).toString("base64url");

test("Passkey endpoints reject oversized chunked JSON bodies before buffering them", async () => {
  const db = new D1TestDatabase();
  try {
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const oversized = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"email":"' + "x".repeat(40 * 1024)));
        controller.close();
      }
    });
    const response = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/signup/options", {
      method: "POST",
      headers: { origin: "https://kitanotes.test", "content-type": "application/json" },
      body: oversized,
      duplex: "half"
    }), env);
    assert.equal(response.status, 400);
    assert.equal(await db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_signup_challenges").get().count, 0);
  } finally {
    db.close();
  }
});


function seedStepUpAtomicFixture(db,{counter=4,challenge=true}={}) {
  const now=new Date().toISOString(), userId="step-up-atomic-user", sessionHash="step-up-atomic-session-hash";
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)")
    .run(userId,"google-step-up-atomic","stepup-atomic@example.com","stepup-atomic@example.com",now,now);
  db.sqlite.prepare("INSERT INTO passkey_credentials (credential_id,user_id,public_key,counter,transports_json,device_type,backed_up,created_at,last_used_at) VALUES (?,?,?,?,?,?,?,?,NULL)")
    .run("step-up-credential",userId,"cHVibGljLWtleQ==",counter,"[]","singleDevice",0,now);
  if(challenge) db.sqlite.prepare("INSERT INTO passkey_step_up_challenges (id,user_id,session_hash,challenge,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .run("step-up-challenge",userId,sessionHash,"step-up-challenge-value",new Date(Date.now()+300000).toISOString(),now);
  return {now,userId,sessionHash};
}
function stepUpAtomicInput(fixture,overrides={}) {
  return {challengeId:"step-up-challenge",userId:fixture.userId,sessionHash:fixture.sessionHash,credentialId:"step-up-credential",expectedCounter:4,newCounter:5,grantId:"step-up-grant",grantTokenHash:"hashed-step-up-token",grantExpiresAt:new Date(Date.now()+120000).toISOString(),now:new Date().toISOString(),...overrides};
}

test("Passkey step-up commits challenge consumption, counter update, and grant together", async () => {
  const db=new D1TestDatabase();
  try {
    const fixture=seedStepUpAtomicFixture(db);
    const result=await commitPasskeyStepUp({DB:db},stepUpAtomicInput(fixture));
    assert.equal(result,"committed");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_step_up_challenges WHERE id='step-up-challenge'").get().count,0);
    assert.equal(db.sqlite.prepare("SELECT counter FROM passkey_credentials WHERE credential_id='step-up-credential'").get().counter,5);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_step_up_grants WHERE token_hash='hashed-step-up-token'").get().count,1);
  } finally { db.close(); }
});

test("Passkey step-up rolls back challenge and counter when grant insertion fails", async () => {
  const db=new D1TestDatabase();
  try {
    const fixture=seedStepUpAtomicFixture(db);
    const originalBatch=db.batch.bind(db);
    db.batch=async statements=>{
      db.sqlite.exec("BEGIN");
      try {
        await statements[0].run();
        await statements[1].run();
        throw new Error("injected step-up grant insert failure");
      } catch(error) {
        db.sqlite.exec("ROLLBACK");
        throw error;
      }
    };
    const result=await commitPasskeyStepUp({DB:db},stepUpAtomicInput(fixture));
    assert.equal(result,"unavailable");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_step_up_challenges WHERE id='step-up-challenge'").get().count,1);
    assert.equal(db.sqlite.prepare("SELECT counter FROM passkey_credentials WHERE credential_id='step-up-credential'").get().counter,4);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_step_up_grants").get().count,0);
    db.batch=originalBatch;
  } finally { db.close(); }
});

test("Passkey step-up rejects a stale credential counter and rolls back challenge consumption", async () => {
  const db=new D1TestDatabase();
  try {
    const fixture=seedStepUpAtomicFixture(db,{counter:9});
    const result=await commitPasskeyStepUp({DB:db},stepUpAtomicInput(fixture));
    assert.equal(result,"conflict");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_step_up_challenges WHERE id='step-up-challenge'").get().count,1);
    assert.equal(db.sqlite.prepare("SELECT counter FROM passkey_credentials WHERE credential_id='step-up-credential'").get().counter,9);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_step_up_grants").get().count,0);
  } finally { db.close(); }
});

test("Passkey step-up rejects replayed or missing challenges without changing the credential", async () => {
  const db=new D1TestDatabase();
  try {
    const fixture=seedStepUpAtomicFixture(db,{challenge:false});
    const result=await commitPasskeyStepUp({DB:db},stepUpAtomicInput(fixture));
    assert.equal(result,"conflict");
    assert.equal(db.sqlite.prepare("SELECT counter FROM passkey_credentials WHERE credential_id='step-up-credential'").get().counter,4);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_step_up_grants").get().count,0);
  } finally { db.close(); }
});

test("Passkey step-up fails closed when D1 batch is unavailable", async () => {
  const fixture={userId:"step-up-no-batch",sessionHash:"session-hash"};
  const result=await commitPasskeyStepUp({DB:{prepare(){throw new Error("must not be called");}}},stepUpAtomicInput(fixture));
  assert.equal(result,"unavailable");
});

test("sensitive Passkey account actions require a fresh step-up grant", async () => {
  const db = new D1TestDatabase();
  try {
    const now = new Date().toISOString();
    const userId = "step-up-user";
    const token = "test-session-token";
    const hash = createHash("sha256").update(token).digest("base64url");
    db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,display_name,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)")
      .run(userId,"google-step-up","stepup@example.com","stepup@example.com","Step Up",now,now);
    db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
      .run("session-step-up",userId,hash,new Date(Date.now()+3600000).toISOString(),now);
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const request = new Request("https://kitanotes.test/api/auth/passkeys/recovery/regenerate", {
      method:"POST",headers:{origin:"https://kitanotes.test",cookie:"__Host-kitanotes_session="+token,"content-type":"application/json"},body:"{}"
    });
    const response = await handleAuthRequest(request,env);
    assert.equal(response.status,403);
    assert.equal((await response.json()).error,"STEP_UP_REQUIRED");
  } finally { db.close(); }
});

test("Recovery-code regeneration preserves existing codes when the D1 batch fails", async () => {
  const db = new D1TestDatabase();
  const now = new Date().toISOString();
  const userId = "recovery-regenerate-atomic";
  const sessionToken = "recovery-regenerate-session";
  const stepUpToken = "recovery-regenerate-step-up";
  const oldCode = "AAAA-BBBB-CCCC-DDDD";
  const oldHash = createHash("sha256").update(oldCode.replace(/-/g, "")).digest("base64url");
  const sessionHash = createHash("sha256").update(sessionToken).digest("base64url");
  const stepUpHash = createHash("sha256").update(stepUpToken).digest("base64url");
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)")
    .run(userId,"google-recovery-atomic","atomic-recovery@example.com","atomic-recovery@example.com",now,now);
  db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
    .run("recovery-regenerate-session",userId,sessionHash,new Date(Date.now()+3600000).toISOString(),now);
  db.sqlite.prepare("INSERT INTO passkey_step_up_grants (id,user_id,session_hash,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .run("recovery-regenerate-grant",userId,sessionHash,stepUpHash,new Date(Date.now()+120000).toISOString(),now);
  db.sqlite.prepare("INSERT INTO passkey_recovery_codes (code_hash,user_id,created_at,used_at) VALUES (?,?,?,NULL)")
    .run(oldHash,userId,now);
  const originalBatch = db.batch.bind(db);
  db.batch = async statements => {
    db.sqlite.exec("BEGIN");
    try {
      await statements[0].run();
      throw new Error("injected recovery-code insert failure");
    } catch (error) {
      db.sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  try {
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const response = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/recovery/regenerate", {
      method:"POST",
      headers:{origin:"https://kitanotes.test",cookie:"__Host-kitanotes_session="+sessionToken,"content-type":"application/json"},
      body:JSON.stringify({stepUpToken})
    }),env);
    assert.equal(response.status,503);
    assert.equal((await response.json()).error,"RECOVERY_TEMPORARILY_UNAVAILABLE");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_recovery_codes WHERE user_id=?").get(userId).count,1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL").get(userId,oldHash).count,1);
  } finally {
    db.batch = originalBatch;
    db.close();
  }
});

test("Recovery-code regeneration fails closed when D1 batch is unavailable", async () => {
  const db = new D1TestDatabase();
  const now = new Date().toISOString();
  const userId = "recovery-regenerate-no-batch";
  const sessionToken = "recovery-regenerate-no-batch-session";
  const stepUpToken = "recovery-regenerate-no-batch-step-up";
  const oldCode = "EEEE-FFFF-GGGG-HHHH";
  const oldHash = createHash("sha256").update(oldCode.replace(/-/g, "")).digest("base64url");
  const sessionHash = createHash("sha256").update(sessionToken).digest("base64url");
  const stepUpHash = createHash("sha256").update(stepUpToken).digest("base64url");
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)")
    .run(userId,"google-recovery-no-batch","no-batch@example.com","no-batch@example.com",now,now);
  db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
    .run("recovery-no-batch-session",userId,sessionHash,new Date(Date.now()+3600000).toISOString(),now);
  db.sqlite.prepare("INSERT INTO passkey_step_up_grants (id,user_id,session_hash,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .run("recovery-no-batch-grant",userId,sessionHash,stepUpHash,new Date(Date.now()+120000).toISOString(),now);
  db.sqlite.prepare("INSERT INTO passkey_recovery_codes (code_hash,user_id,created_at,used_at) VALUES (?,?,?,NULL)")
    .run(oldHash,userId,now);
  try {
    db.batch = undefined;
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const response = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/recovery/regenerate", {
      method:"POST",
      headers:{origin:"https://kitanotes.test",cookie:"__Host-kitanotes_session="+sessionToken,"content-type":"application/json"},
      body:JSON.stringify({stepUpToken})
    }),env);
    assert.equal(response.status,503);
    assert.equal((await response.json()).error,"RECOVERY_TEMPORARILY_UNAVAILABLE");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL").get(userId,oldHash).count,1);
  } finally { db.close(); }
});

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
    const workspace = db.sqlite.prepare("SELECT id,workspace_type,visibility FROM workspaces WHERE owner_user_id=? AND visibility='private'").get(user.id);
    assert.ok(workspace);
    assert.equal(workspace.workspace_type,"shared");
    assert.equal(workspace.visibility,"private");
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



test("Passkey registration options are only available to an authenticated same-origin account", async () => {
  const db = new D1TestDatabase();
  const secret = "local-test-session-secret-with-more-than-32-characters";
  const now = new Date().toISOString();
  const token = "existing-google-session-token";
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(token).digest("base64url");
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES ('existing-user','google-sub-existing','existing@example.com','existing@example.com',1,?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ('existing-session','existing-user',?,?,?)").run(hash,"2099-01-01T00:00:00.000Z",now);
  try {
    const env = { DB: db, SESSION_SECRET: secret, APP_BASE_URL: "https://kitanotes.test" };
    const response = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/register/options", {
      method: "POST",
      headers: { origin: "https://kitanotes.test", cookie: "__Host-kitanotes_session=" + token }
    }), env);
    assert.equal(response.status, 200);
    const options = await response.json();
    assert.ok(options.challenge);
    assert.equal(options.rp.id, "kitanotes.test");
    assert.equal(options.authenticatorSelection.residentKey, "required");
    assert.equal(options.authenticatorSelection.userVerification, "required");
    const pending = db.sqlite.prepare("SELECT user_id,purpose FROM passkey_challenges WHERE challenge=?").get(options.challenge);
    assert.deepEqual({ ...pending }, { user_id: "existing-user", purpose: "register" });
  } finally {
    db.close();
  }
});

test("Passkey login options are discoverable and challenge-bound without creating a new user", async () => {
  const db = new D1TestDatabase();
  const now = new Date().toISOString();
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES ('existing-user','google-sub-existing','existing@example.com','existing@example.com',1,?,?)").run(now,now);
  try {
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const response = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/authenticate/options", {
      method: "POST",
      headers: { origin: "https://kitanotes.test" }
    }), env);
    assert.equal(response.status, 200);
    const options = await response.json();
    assert.ok(options.challenge);
    assert.equal(options.userVerification, "required");
    assert.equal(options.allowCredentials?.length ?? 0, 0);
    const pending = db.sqlite.prepare("SELECT user_id,purpose FROM passkey_challenges WHERE challenge=?").get(options.challenge);
    assert.deepEqual({ ...pending }, { user_id: null, purpose: "authenticate" });
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_credentials").get().count, 0);
  } finally {
    db.close();
  }
});

test("Passkey endpoints reject cross-origin mutations and malformed verification payloads", async () => {
  const db = new D1TestDatabase();
  try {
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const csrf = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/authenticate/options", {
      method: "POST",
      headers: { origin: "https://attacker.test" }
    }), env);
    assert.equal(csrf.status, 403);
    const malformed = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/authenticate/verify", {
      method: "POST",
      headers: { origin: "https://kitanotes.test", "content-type": "application/json" },
      body: JSON.stringify({ challenge: "not-a-real-challenge", response: {} })
    }), env);
    assert.equal(malformed.status, 400);
  } finally {
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

test("Passkey signup options create a short-lived challenge without creating an account", async () => {
  const db = new D1TestDatabase();
  try {
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const response = await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/signup/options", {
      method: "POST",
      headers: { origin: "https://kitanotes.test", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "New Person", email: "new@example.com" })
    }), env);
    assert.equal(response.status, 200);
    const options = await response.json();
    assert.ok(options.challenge);
    assert.equal(options.authenticatorSelection.residentKey, "required");
    assert.equal(options.authenticatorSelection.userVerification, "required");
    const pending = db.sqlite.prepare("SELECT email_normalized,display_name FROM passkey_signup_challenges WHERE challenge=?").get(options.challenge);
    assert.deepEqual({ ...pending }, { email_normalized: "new@example.com", display_name: "New Person" });
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  } finally { db.close(); }
});

test("Passkey recovery codes are single-use and issue the normal session cookie", async () => {
  const db = new D1TestDatabase();
  const now = new Date().toISOString();
  const code = "A1B2C3D4-E5F60718-192A3B4C-5D6E7F80";
  const normalized = code.replace(/-/g, "");
  const hash = createHash("sha256").update(normalized).digest("base64url");
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES ('recovery-user','passkey:recovery-user','recovery@example.com','recovery@example.com',0,?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO passkey_recovery_codes (code_hash,user_id,created_at) VALUES (?,?,?)").run(hash,"recovery-user",now);
  try {
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const request = () => new Request("https://kitanotes.test/api/auth/passkeys/recovery/verify", {
      method: "POST", headers: { origin: "https://kitanotes.test", "content-type": "application/json" },
      body: JSON.stringify({ code: code.replace("A1B2C3D4", "A1B2 C3D4").replace("E5F60718", "E5F6 0718") })
    });
    const first = await handleAuthRequest(request(),env);
    assert.equal(first.status,200);
    assert.match(first.headers.get("set-cookie") ?? "",/__Host-kitanotes_session=/);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_recovery_codes WHERE code_hash=? AND used_at IS NULL").get(hash).count,0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id='recovery-user'").get().count,1);
    const second = await handleAuthRequest(request(),env);
    assert.equal(second.status,401);
  } finally { db.close(); }
});



test("Passkey recovery rolls back code consumption if session creation fails", async () => {
  const db = new D1TestDatabase();
  const now = new Date().toISOString();
  const code = "11112222-33334444-55556666-77778888";
  const hash = createHash("sha256").update(code.replace(/-/g,"")).digest("base64url");
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES ('recovery-atomic','passkey:recovery-atomic','atomic@example.com','atomic@example.com',0,?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO passkey_recovery_codes (code_hash,user_id,created_at) VALUES (?,?,?)").run(hash,"recovery-atomic",now);
  const originalBatch=db.batch.bind(db);
  db.batch=async statements=>{
    db.sqlite.exec("BEGIN");
    try {
      await statements[0].run();
      throw new Error("injected session insert failure");
    } catch(error) {
      db.sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  try {
    const env = { DB: db, SESSION_SECRET: "local-test-session-secret-with-more-than-32-characters", APP_BASE_URL: "https://kitanotes.test" };
    const response=await handleAuthRequest(new Request("https://kitanotes.test/api/auth/passkeys/recovery/verify", {
      method:"POST",headers:{origin:"https://kitanotes.test","content-type":"application/json"},body:JSON.stringify({code})
    }),env);
    assert.equal(response.status,503);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM passkey_recovery_codes WHERE code_hash=? AND used_at IS NULL").get(hash).count,1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id='recovery-atomic'").get().count,0);
  } finally {
    db.batch=originalBatch;
    db.close();
  }
});

test("Google recovery linking is bound to the authenticated passkey account", async () => {
  const db = new D1TestDatabase();
  const secret = "local-test-session-secret-with-more-than-32-characters";
  const token = "passkey-account-session";
  const now = new Date().toISOString();
  const hash = createHash("sha256").update(token).digest("base64url");
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES ('passkey-user','passkey:passkey-user','owner@example.com','owner@example.com',0,?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ('passkey-session','passkey-user',?,?,?)").run(hash,"2099-01-01T00:00:00.000Z",now);
  try {
    const env = { DB: db, GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret", SESSION_SECRET: secret, APP_BASE_URL: "https://kitanotes.test" };
    const response = await handleAuthRequest(new Request("https://kitanotes.test/auth/google/link", {
      headers: { cookie: "__Host-kitanotes_session=" + token }
    }),env);
    assert.equal(response.status,302);
    const cookie = response.headers.get("set-cookie") ?? "";
    const stateCookie = cookie.match(/__Host-kitanotes_oauth=([^;]+)/)?.[1];
    assert.ok(stateCookie);
    const [payload,signature] = stateCookie.split(".");
    assert.equal(signature,createHmac("sha256",secret).update(payload).digest("base64url"));
    const decoded = JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    assert.equal(decoded.linkUserId,"passkey-user");
    assert.equal(decoded.linkSessionHash,hash);
    assert.equal(decoded.returnTo,"/");
  } finally { db.close(); }
});


test("verified Google login claims an unverified Passkey signup without creating a duplicate account", async () => {
  const db = new D1TestDatabase();
  const secret = "local-test-session-secret-with-more-than-32-characters";
  const nowIso = new Date().toISOString();
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,display_name,created_at,updated_at) VALUES ('reserved-user','passkey:reserved-user','claimed@example.com','claimed@example.com',0,'Passkey User',?,?)").run(nowIso,nowIso);
  db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES ('reserved-workspace','Personal','reserved-user','shared','private',?,?)").run(nowIso,nowIso);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('reserved-workspace','reserved-user','owner',?)").run(nowIso);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 0x10001 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "google-claim-key", alg: "RS256", use: "sig" };
  const nonce = "claim-nonce";
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", kid: "google-claim-key" }));
  const claims = base64url(JSON.stringify({ iss: "https://accounts.google.com", aud: "test-client-id", exp: now + 300, iat: now, nonce, sub: "verified-google-sub", email: "claimed@example.com", email_verified: true, name: "Verified Owner" }));
  const signingInput = header + "." + claims;
  const idToken = signingInput + "." + sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  const verifier = "claim-pkce-verifier";
  const state = "claim-state";
  const encodedState = base64url(JSON.stringify({ state, nonce, verifier, returnTo: "/", issuedAt: Date.now() }));
  const signature = createHmac("sha256", secret).update(encodedState).digest("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    throw new Error("Unexpected fetch URL: " + url);
  };
  try {
    const env = { DB: db, GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret", SESSION_SECRET: secret, APP_BASE_URL: "https://kitanotes.test" };
    const response = await handleAuthRequest(new Request("https://kitanotes.test/auth/google/callback?code=google-code&state=" + state, {
      headers: { cookie: "__Host-kitanotes_oauth=" + encodedState + "." + signature }
    }), env);
    assert.equal(response.status, 302);
    const user = db.sqlite.prepare("SELECT id,google_sub,email_verified FROM users WHERE email_normalized='claimed@example.com'").get();
    assert.equal(user.id, "reserved-user");
    assert.equal(user.google_sub, "verified-google-sub");
    assert.equal(user.email_verified, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE email_normalized='claimed@example.com'").get().count, 1);
    assert.ok(db.sqlite.prepare("SELECT id FROM workspaces WHERE id='reserved-workspace' AND owner_user_id='reserved-user'").get());
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id='reserved-user'").get().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
