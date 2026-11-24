import { consumeRateLimit, rateLimitResponse } from "./rate-limit.ts";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
export type D1BoundStatementLike = {
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

export type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): D1BoundStatementLike;
  };
  batch?(statements: D1BoundStatementLike[]): Promise<unknown[]>;
};

export interface AuthEnv {
  DB?: D1Like;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  APP_BASE_URL?: string;
}

const SESSION_COOKIE = "__Host-kitanotes_session";
const OAUTH_COOKIE = "__Host-kitanotes_oauth";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value: string): Uint8Array {
  const normal = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normal + "=".repeat((4 - (normal.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJsonPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(value))) as T;
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64Url(new Uint8Array(signature));
}

async function signState(payload: string, secret: string): Promise<string> {
  return payload + "." + await hmac(payload, secret);
}

async function verifyState(value: string, secret: string): Promise<Record<string, unknown> | null> {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = await hmac(payload, secret);
  if (signature !== expected) return null;
  try {
    return decodeJsonPart<Record<string, unknown>>(payload);
  } catch {
    return null;
  }
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function appendCookie(headers: Headers, value: string): void {
  headers.append("set-cookie", value);
}

function clearCookie(headers: Headers, name: string): void {
  appendCookie(headers, name + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}

function json(data: unknown, status = 200, headers = new Headers()): Response {
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}

function baseUrl(request: Request, env: AuthEnv): URL {
  const configured = env.APP_BASE_URL?.trim();
  const result = new URL(configured || new URL(request.url).origin);
  if (result.protocol !== "https:" && result.hostname !== "localhost" && result.hostname !== "127.0.0.1") {
    throw new Error("APP_BASE_URL must use HTTPS outside local development");
  }
  return result;
}

function authConfiguration(env: AuthEnv): string | null {
  if (!env.DB) return "Database binding is not configured.";
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return "Google OAuth credentials are not configured.";
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return "SESSION_SECRET must contain at least 32 characters.";
  return null;
}

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  expectedNonce: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ sub: string; email: string; name?: string; picture?: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid identity token");
  const header = decodeJsonPart<{ alg?: string; kid?: string }>(parts[0]);
  const claims = decodeJsonPart<{
    iss?: string; aud?: string | string[]; azp?: string; exp?: number; iat?: number;
    nonce?: string; sub?: string; email?: string; email_verified?: boolean | string;
    name?: string; picture?: string;
  }>(parts[1]);

  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported identity token signature");
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss ?? "")) throw new Error("Invalid identity token issuer");
  if (!audiences.includes(clientId) || (audiences.length > 1 && claims.azp !== clientId)) throw new Error("Invalid identity token audience");
  if (!claims.exp || claims.exp <= now || !claims.iat || claims.iat > now + 300) throw new Error("Expired or invalid identity token");
  if (!claims.sub || !claims.email || !(claims.email_verified === true || claims.email_verified === "true")) throw new Error("Google account email is not verified");
  if (!claims.nonce || claims.nonce !== expectedNonce) throw new Error("Invalid identity token nonce");

  const jwksResponse = await fetchImpl("https://www.googleapis.com/oauth2/v3/certs", { headers: { accept: "application/json" } });
  if (!jwksResponse.ok) throw new Error("Unable to retrieve Google signing keys");
  const jwks = await jwksResponse.json() as { keys?: JsonWebKey[] };
  const jwk = jwks.keys?.find(key => (key as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error("Google signing key not found");
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, fromBase64Url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!valid) throw new Error("Invalid identity token signature");

  return { sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture };
}

async function startGoogleLogin(request: Request, env: AuthEnv): Promise<Response> {
  const configError = authConfiguration(env);
  if (configError) return json({ error: "AUTH_NOT_CONFIGURED", message: configError }, 503);
  const origin = baseUrl(request, env);
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const fingerprint = await hmac(clientIp, env.SESSION_SECRET!);
  const rate = await consumeRateLimit(env.DB!, "oauth:start:" + fingerprint, 10, 10 * 60 * 1000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const requestedReturnTo = new URL(request.url).searchParams.get("returnTo") ?? "/";
  let returnTo = "/";
  if (requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//") && !requestedReturnTo.includes("\\")) {
    const target = new URL(requestedReturnTo, origin);
    if (target.origin === origin.origin) returnTo = target.pathname + target.search + target.hash;
  }
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ state, nonce, verifier, returnTo, issuedAt: Date.now() })));
  const signed = await signState(payload, env.SESSION_SECRET!);
  const challenge = await sha256(verifier);
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: new URL("/auth/google/callback", origin).toString(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account"
  }).toString();
  const headers = new Headers({ location: authorize.toString(), "cache-control": "no-store" });
  appendCookie(headers, OAUTH_COOKIE + "=" + signed + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + OAUTH_TTL_SECONDS);
  return new Response(null, { status: 302, headers });
}

async function createUserAndSession(
  env: AuthEnv,
  identity: { sub: string; email: string; name?: string; picture?: string }
): Promise<{ token: string; expiresAt: string }> {
  const db = env.DB!;
  const now = new Date().toISOString();
  const emailNormalized = identity.email.trim().toLowerCase();
  const proposedUserId = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO users (id,google_sub,email,email_normalized,email_verified,display_name,avatar_url,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,email_normalized=excluded.email_normalized,email_verified=1,display_name=excluded.display_name,avatar_url=excluded.avatar_url,updated_at=excluded.updated_at"
  ).bind(proposedUserId, identity.sub, identity.email, emailNormalized, identity.name ?? null, identity.picture ?? null, now, now).run();

  const user = await db.prepare("SELECT id FROM users WHERE google_sub=?").bind(identity.sub).first<{ id: string }>();
  if (!user?.id) throw new Error("Unable to create user account");

  await db.prepare(
    "INSERT OR IGNORE INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), "Personal", user.id, "shared", "private", now, now).run();
  const workspace = await db.prepare("SELECT id FROM workspaces WHERE owner_user_id=? AND visibility='private' ORDER BY created_at ASC LIMIT 1").bind(user.id).first<{ id: string }>();
  if (!workspace?.id) throw new Error("Unable to create personal workspace");
  await db.prepare(
    "INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)"
  ).bind(workspace.id, user.id, "owner", now).run();

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)"
  ).bind(crypto.randomUUID(), user.id, await sha256(token), expiresAt, now).run();
  return { token, expiresAt };
}

async function completeGoogleLogin(request: Request, env: AuthEnv): Promise<Response> {
  const configError = authConfiguration(env);
  if (configError) return json({ error: "AUTH_NOT_CONFIGURED", message: configError }, 503);
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const fingerprint = await hmac(clientIp, env.SESSION_SECRET!);
  const rate = await consumeRateLimit(env.DB!, "oauth:callback:" + fingerprint, 20, 10 * 60 * 1000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const headers = new Headers({ "cache-control": "no-store" });
  const stateCookie = getCookie(request, OAUTH_COOKIE);
  clearCookie(headers, OAUTH_COOKIE);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  if (providerError || !code || !state || !stateCookie) return json({ error: "OAUTH_CALLBACK_INVALID" }, 400, headers);

  const payload = await verifyState(stateCookie, env.SESSION_SECRET!);
  if (!payload || payload.state !== state || typeof payload.nonce !== "string" || typeof payload.verifier !== "string" ||
      typeof payload.issuedAt !== "number" || Date.now() - payload.issuedAt > OAUTH_TTL_SECONDS * 1000) {
    return json({ error: "OAUTH_STATE_INVALID" }, 400, headers);
  }

  const origin = baseUrl(request, env);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: new URL("/auth/google/callback", origin).toString(),
      grant_type: "authorization_code",
      code_verifier: payload.verifier
    })
  });
  if (!tokenResponse.ok) return json({ error: "GOOGLE_TOKEN_EXCHANGE_FAILED" }, 502, headers);
  const tokenPayload = await tokenResponse.json() as { id_token?: string };
  if (!tokenPayload.id_token) return json({ error: "GOOGLE_ID_TOKEN_MISSING" }, 502, headers);

  try {
    const identity = await verifyGoogleIdToken(tokenPayload.id_token, env.GOOGLE_CLIENT_ID!, payload.nonce);
    const session = await createUserAndSession(env, identity);
    appendCookie(headers, SESSION_COOKIE + "=" + session.token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + SESSION_TTL_SECONDS);
    const returnTo = typeof payload.returnTo === "string" && payload.returnTo.startsWith("/") && !payload.returnTo.startsWith("//") && !payload.returnTo.includes("\\") ? payload.returnTo : "/";
    headers.set("location", new URL(returnTo, origin).toString());
    return new Response(null, { status: 302, headers });
  } catch {
    return json({ error: "GOOGLE_IDENTITY_VALIDATION_FAILED" }, 401, headers);
  }
}

export async function getCurrentUser(request: Request, env: AuthEnv): Promise<{ id: string; email: string; displayName: string | null; avatarUrl: string | null; personalWorkspaceId: string | null } | null> {
  if (!env.DB) return null;
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT u.id,u.email,u.display_name,u.avatar_url,s.expires_at,(SELECT w.id FROM workspaces w WHERE w.owner_user_id=u.id AND w.visibility='private' ORDER BY w.created_at ASC LIMIT 1) AS personal_workspace_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?"
  ).bind(hash).first<{ id: string; email: string; display_name: string | null; avatar_url: string | null; expires_at: string; personal_workspace_id: string | null }>();
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(hash).run();
    return null;
  }
  return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url, personalWorkspaceId: row.personal_workspace_id };
}

async function logout(request: Request, env: AuthEnv): Promise<Response> {
  const headers = new Headers();
  clearCookie(headers, SESSION_COOKIE);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403, headers);
  const token = getCookie(request, SESSION_COOKIE);
  if (token && env.DB) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, headers);
}



const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_AUTH_BODY_BYTES = 32 * 1024;

type PasskeyChallengeRow = { id: string; user_id: string | null; challenge: string; purpose: "register" | "authenticate"; expires_at: string };
type PasskeyCredentialRow = { credential_id: string; user_id: string; public_key: string; counter: number; transports_json: string | null; email: string; display_name: string | null; avatar_url: string | null };

function passkeyRelyingParty(request: Request, env: AuthEnv): { id: string; origin: string } {
  const configured = baseUrl(request, env);
  return { id: configured.hostname, origin: configured.origin };
}

function isSameOriginMutation(request: Request, env: AuthEnv): boolean {
  const origin = request.headers.get("origin");
  return !!origin && origin === baseUrl(request, env).origin;
}

async function readAuthJson(request: Request): Promise<Record<string, any> | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_AUTH_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_AUTH_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
  } catch {
    return null;
  }
}

async function passkeyRateLimit(request: Request, env: AuthEnv, action: string, limit: number): Promise<Response | null> {
  if (!env.DB || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const fingerprint = await hmac(ip, env.SESSION_SECRET);
  const rate = await consumeRateLimit(env.DB, "passkey:" + action + ":" + fingerprint, limit, 10 * 60 * 1000);
  return rate.allowed ? null : rateLimitResponse(rate.retryAfterSeconds);
}

async function savePasskeyChallenge(env: AuthEnv, challenge: string, userId: string | null, purpose: "register" | "authenticate"): Promise<void> {
  const now = new Date();
  await env.DB!.prepare(
    "INSERT INTO passkey_challenges (id,user_id,challenge,purpose,expires_at,created_at) VALUES (?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), userId, challenge, purpose, new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000).toISOString(), now.toISOString()).run();
}

async function consumePasskeyChallenge(env: AuthEnv, challenge: string, userId: string | null, purpose: "register" | "authenticate"): Promise<boolean> {
  const now = new Date().toISOString();
  const row = await env.DB!.prepare(
    "SELECT id FROM passkey_challenges WHERE challenge=? AND purpose=? AND user_id IS ? AND expires_at>? LIMIT 1"
  ).bind(challenge, purpose, userId, now).first<{ id: string }>();
  if (!row) return false;
  const result = await env.DB!.prepare(
    "DELETE FROM passkey_challenges WHERE id=? AND challenge=? AND purpose=? AND user_id IS ? AND expires_at>?"
  ).bind(row.id, challenge, purpose, userId, now).run() as { meta?: { changes?: number } };
  return result.meta?.changes === 1;
}

async function startPasskeyRegistration(request: Request, env: AuthEnv): Promise<Response> {
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  if (!isSameOriginMutation(request, env)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  const limited = await passkeyRateLimit(request, env, "register-options:" + user.id, 10);
  if (limited) return limited;
  const rp = passkeyRelyingParty(request, env);
  const existing = await env.DB.prepare(
    "SELECT credential_id,transports_json FROM passkey_credentials WHERE user_id=?"
  ).bind(user.id).all<{ credential_id: string; transports_json: string | null }>();
  const options = await generateRegistrationOptions({
    rpName: "KitaNotes",
    rpID: rp.id,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.displayName || user.email,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: existing.results.map(item => ({
      id: item.credential_id,
      transports: item.transports_json ? JSON.parse(item.transports_json) : undefined
    }))
  });
  await savePasskeyChallenge(env, options.challenge, user.id, "register");
  return json(options);
}

async function finishPasskeyRegistration(request: Request, env: AuthEnv): Promise<Response> {
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  if (!isSameOriginMutation(request, env)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  const limited = await passkeyRateLimit(request, env, "register-verify:" + user.id, 10);
  if (limited) return limited;
  const body = await readAuthJson(request);
  if (!body || typeof body.challenge !== "string" || !body.response || typeof body.response !== "object") return json({ error: "INVALID_PASSKEY_RESPONSE" }, 400);
  const pending = await env.DB.prepare(
    "SELECT id FROM passkey_challenges WHERE challenge=? AND purpose='register' AND user_id=? AND expires_at>? LIMIT 1"
  ).bind(body.challenge, user.id, new Date().toISOString()).first<{ id: string }>();
  if (!pending) return json({ error: "PASSKEY_CHALLENGE_EXPIRED" }, 400);
  try {
    const rp = passkeyRelyingParty(request, env);
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: body.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo) return json({ error: "PASSKEY_VERIFICATION_FAILED" }, 400);
    const info = verification.registrationInfo;
    const credential = info.credential;
    const consumed = await consumePasskeyChallenge(env, body.challenge, user.id, "register");
    if (!consumed) return json({ error: "PASSKEY_CHALLENGE_ALREADY_USED" }, 409);
    await env.DB.prepare(
      "INSERT INTO passkey_credentials (credential_id,user_id,public_key,counter,transports_json,device_type,backed_up,created_at,last_used_at) VALUES (?,?,?,?,?,?,?,?,NULL)"
    ).bind(
      credential.id,
      user.id,
      base64Url(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      info.credentialDeviceType,
      info.credentialBackedUp ? 1 : 0,
      new Date().toISOString()
    ).run();
    return json({ verified: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/UNIQUE|constraint/i.test(message)) return json({ error: "PASSKEY_ALREADY_REGISTERED" }, 409);
    return json({ error: "PASSKEY_REGISTRATION_FAILED" }, 400);
  }
}

async function startPasskeyAuthentication(request: Request, env: AuthEnv): Promise<Response> {
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  if (!isSameOriginMutation(request, env)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const limited = await passkeyRateLimit(request, env, "authenticate-options", 20);
  if (limited) return limited;
  const rp = passkeyRelyingParty(request, env);
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "required" });
  await savePasskeyChallenge(env, options.challenge, null, "authenticate");
  return json(options);
}

async function finishPasskeyAuthentication(request: Request, env: AuthEnv): Promise<Response> {
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  if (!isSameOriginMutation(request, env)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const limited = await passkeyRateLimit(request, env, "authenticate-verify", 20);
  if (limited) return limited;
  const body = await readAuthJson(request);
  if (!body || typeof body.challenge !== "string" || !body.response || typeof body.response.id !== "string") return json({ error: "INVALID_PASSKEY_RESPONSE" }, 400);
  const pending = await env.DB.prepare(
    "SELECT id FROM passkey_challenges WHERE challenge=? AND purpose='authenticate' AND user_id IS NULL AND expires_at>? LIMIT 1"
  ).bind(body.challenge, new Date().toISOString()).first<{ id: string }>();
  if (!pending) return json({ error: "PASSKEY_CHALLENGE_EXPIRED" }, 400);
  const credential = await env.DB.prepare(
    "SELECT p.credential_id,p.user_id,p.public_key,p.counter,p.transports_json,u.email,u.display_name,u.avatar_url FROM passkey_credentials p JOIN users u ON u.id=p.user_id WHERE p.credential_id=?"
  ).bind(body.response.id).first<PasskeyCredentialRow>();
  if (!credential) return json({ error: "PASSKEY_NOT_RECOGNISED" }, 401);
  try {
    const expectedUserHandle = base64Url(new TextEncoder().encode(credential.user_id));
    const suppliedUserHandle = body.response.response?.userHandle;
    if (typeof suppliedUserHandle !== "string" || suppliedUserHandle !== expectedUserHandle) return json({ error: "PASSKEY_USER_HANDLE_INVALID" }, 401);
    const rp = passkeyRelyingParty(request, env);
    const transports = credential.transports_json ? JSON.parse(credential.transports_json) : [];
    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: body.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: credential.credential_id,
        publicKey: fromBase64Url(credential.public_key),
        counter: credential.counter,
        transports
      },
      requireUserVerification: true
    });
    if (!verification.verified) return json({ error: "PASSKEY_VERIFICATION_FAILED" }, 401);
    const consumed = await consumePasskeyChallenge(env, body.challenge, null, "authenticate");
    if (!consumed) return json({ error: "PASSKEY_CHALLENGE_ALREADY_USED" }, 409);
    const updated = await env.DB.prepare(
      "UPDATE passkey_credentials SET counter=?,last_used_at=? WHERE credential_id=? AND counter=?"
    ).bind(verification.authenticationInfo.newCounter, new Date().toISOString(), credential.credential_id, credential.counter).run() as { meta?: { changes?: number } };
    if (updated.meta?.changes !== 1) return json({ error: "PASSKEY_COUNTER_CONFLICT" }, 409);
    const session = await createSessionForUser(env, credential.user_id);
    const headers = new Headers();
    appendCookie(headers, SESSION_COOKIE + "=" + session.token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + SESSION_TTL_SECONDS);
    return json({
      authenticated: true,
      user: { id: credential.user_id, email: credential.email, displayName: credential.display_name, avatarUrl: credential.avatar_url }
    }, 200, headers);
  } catch {
    return json({ error: "PASSKEY_AUTHENTICATION_FAILED" }, 401);
  }
}

async function createSessionForUser(env: AuthEnv, userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB!.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)"
  ).bind(crypto.randomUUID(), userId, await sha256(token), expiresAt, now).run();
  return { token, expiresAt };
}

async function listPasskeys(request: Request, env: AuthEnv): Promise<Response> {
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  const result = await env.DB.prepare(
    "SELECT credential_id,device_type,backed_up,created_at,last_used_at FROM passkey_credentials WHERE user_id=? ORDER BY created_at DESC"
  ).bind(user.id).all<{ credential_id: string; device_type: string; backed_up: number; created_at: string; last_used_at: string | null }>();
  return json({ passkeys: result.results.map(item => ({
    id: item.credential_id,
    deviceType: item.device_type,
    backedUp: item.backed_up === 1,
    createdAt: item.created_at,
    lastUsedAt: item.last_used_at
  })) });
}

async function removePasskey(request: Request, env: AuthEnv, credentialId: string): Promise<Response> {
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  if (!isSameOriginMutation(request, env)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  const result = await env.DB.prepare(
    "DELETE FROM passkey_credentials WHERE credential_id=? AND user_id=?"
  ).bind(credentialId, user.id).run() as { meta?: { changes?: number } };
  return result.meta?.changes === 1 ? json({ ok: true }) : json({ error: "PASSKEY_NOT_FOUND" }, 404);
}

export async function handleAuthRequest(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/status" && request.method === "GET") return json({ ready: authConfiguration(env) === null });
  if (url.pathname === "/auth/google" && request.method === "GET") return startGoogleLogin(request, env);
  if (url.pathname === "/auth/google/callback" && request.method === "GET") return completeGoogleLogin(request, env);
  if (url.pathname === "/api/auth/passkeys/register/options" && request.method === "POST") return startPasskeyRegistration(request, env);
  if (url.pathname === "/api/auth/passkeys/register/verify" && request.method === "POST") return finishPasskeyRegistration(request, env);
  if (url.pathname === "/api/auth/passkeys/authenticate/options" && request.method === "POST") return startPasskeyAuthentication(request, env);
  if (url.pathname === "/api/auth/passkeys/authenticate/verify" && request.method === "POST") return finishPasskeyAuthentication(request, env);
  if (url.pathname === "/api/auth/passkeys" && request.method === "GET") return listPasskeys(request, env);
  if (url.pathname.startsWith("/api/auth/passkeys/") && request.method === "DELETE") return removePasskey(request, env, decodeURIComponent(url.pathname.slice("/api/auth/passkeys/".length)));
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
    const user = await getCurrentUser(request, env);
    return user ? json({ authenticated: true, user }) : json({ authenticated: false }, 401);
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  return null;
}
