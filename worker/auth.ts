export type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
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
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ state, nonce, verifier, issuedAt: Date.now() })));
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
    "INSERT OR IGNORE INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES (?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), "Personal", user.id, "personal", now, now).run();
  const workspace = await db.prepare("SELECT id FROM workspaces WHERE owner_user_id=? AND workspace_type='personal'").bind(user.id).first<{ id: string }>();
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
    headers.set("location", new URL("/", origin).toString());
    return new Response(null, { status: 302, headers });
  } catch {
    return json({ error: "GOOGLE_IDENTITY_VALIDATION_FAILED" }, 401, headers);
  }
}

export async function getCurrentUser(request: Request, env: AuthEnv): Promise<{ id: string; email: string; displayName: string | null; avatarUrl: string | null } | null> {
  if (!env.DB) return null;
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT u.id,u.email,u.display_name,u.avatar_url,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?"
  ).bind(hash).first<{ id: string; email: string; display_name: string | null; avatar_url: string | null; expires_at: string }>();
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(hash).run();
    return null;
  }
  return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url };
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

export async function handleAuthRequest(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/auth/google" && request.method === "GET") return startGoogleLogin(request, env);
  if (url.pathname === "/auth/google/callback" && request.method === "GET") return completeGoogleLogin(request, env);
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
    const user = await getCurrentUser(request, env);
    return user ? json({ authenticated: true, user }) : json({ authenticated: false }, 401);
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  return null;
}
