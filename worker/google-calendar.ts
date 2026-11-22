import { getCurrentUser, type AuthEnv } from "./auth.ts";
import { consumeRateLimit, rateLimitResponse } from "./rate-limit.ts";

type Db = NonNullable<AuthEnv["DB"]>;
type CalendarEnv = AuthEnv & { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const REDIRECT_PATH = "/auth/google/calendar/callback";
const TIMEZONE_FALLBACK = "Asia/Kuala_Lumpur";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
function baseUrl(request: Request, env: CalendarEnv): URL {
  return new URL(env.APP_BASE_URL?.trim() || new URL(request.url).origin);
}
function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes); crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function encryptionKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("kitanotes-google-calendar:" + secret));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptToken(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(value));
  const bytes = new Uint8Array(iv.length + encrypted.byteLength); bytes.set(iv); bytes.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function decryptToken(value: string, secret: string): Promise<string> {
  const normal = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(normal + "=".repeat((4 - normal.length % 4) % 4)), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await encryptionKey(secret), bytes.slice(12));
  return new TextDecoder().decode(plain);
}
function sameOrigin(request: Request): boolean { return request.headers.get("origin") === new URL(request.url).origin; }
async function workspaceRole(db: Db, workspaceId: string, userId: string): Promise<string | null> {
  const row = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId, userId).first<{ role: string }>();
  return row?.role ?? null;
}
function redirect(request: Request, env: CalendarEnv, result: string): Response {
  const target = new URL("/", baseUrl(request, env)); target.searchParams.set("googleCalendar", result);
  return new Response(null, { status: 302, headers: { location: target.toString(), "cache-control": "no-store" } });
}

async function startConnect(request: Request, env: CalendarEnv): Promise<Response> {
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return json({ error: "GOOGLE_CALENDAR_NOT_CONFIGURED" }, 503);
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!workspaceId || !["owner", "editor"].includes((await workspaceRole(env.DB, workspaceId, user.id)) ?? "")) return json({ error: "WORKSPACE_FORBIDDEN" }, 403);
  await env.DB.prepare("DELETE FROM google_calendar_oauth_states WHERE expires_at<=?").bind(new Date().toISOString()).run();
  const state = randomToken();
  const verifier = randomToken(48);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await env.DB.prepare("INSERT INTO google_calendar_oauth_states (state_hash,user_id,workspace_id,code_verifier,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .bind(await sha256(state), user.id, workspaceId, verifier, expiresAt, new Date().toISOString()).run();
  const challenge = await sha256(verifier);
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: new URL(REDIRECT_PATH, baseUrl(request, env)).toString(),
    response_type: "code", scope: "openid email profile " + SCOPE, access_type: "offline", prompt: "consent select_account",
    include_granted_scopes: "false", state, code_challenge: challenge, code_challenge_method: "S256"
  }).toString();
  return new Response(null, { status: 302, headers: { location: authorize.toString(), "cache-control": "no-store" } });
}

async function completeConnect(request: Request, env: CalendarEnv): Promise<Response> {
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return redirect(request, env, "error");
  const user = await getCurrentUser(request, env);
  if (!user) return redirect(request, env, "signin_required");
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || url.searchParams.has("error")) return redirect(request, env, "error");
  const row = await env.DB.prepare("SELECT state_hash,user_id,workspace_id,code_verifier,expires_at FROM google_calendar_oauth_states WHERE state_hash=?")
    .bind(await sha256(state)).first<{ state_hash: string; user_id: string; workspace_id: string; code_verifier: string; expires_at: string }>();
  if (!row || row.user_id !== user.id || row.expires_at <= new Date().toISOString()) return redirect(request, env, "state_error");
  await env.DB.prepare("DELETE FROM google_calendar_oauth_states WHERE state_hash=?").bind(row.state_hash).run();
  if (!["owner", "editor"].includes((await workspaceRole(env.DB, row.workspace_id, user.id)) ?? "")) return redirect(request, env, "workspace_error");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: new URL(REDIRECT_PATH, baseUrl(request, env)).toString(), grant_type: "authorization_code", code_verifier: row.code_verifier })
  });
  if (!tokenResponse.ok) return redirect(request, env, "token_error");
  const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!tokens.access_token || !(tokens.scope ?? "").split(" ").includes(SCOPE)) return redirect(request, env, "scope_error");
  let encrypted = tokens.refresh_token ? await encryptToken(tokens.refresh_token, env.SESSION_SECRET) : null;
  if (!encrypted) {
    const existing = await env.DB.prepare("SELECT refresh_token_ciphertext FROM google_calendar_connections WHERE user_id=? AND workspace_id=?")
      .bind(user.id, row.workspace_id).first<{ refresh_token_ciphertext: string | null }>();
    encrypted = existing?.refresh_token_ciphertext ?? null;
  }
  if (!encrypted) return redirect(request, env, "refresh_token_missing");
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO google_calendar_connections (id,user_id,workspace_id,calendar_id,refresh_token_ciphertext,sync_token,last_sync_at,created_at,updated_at) VALUES (?,?,?,'primary',?,NULL,NULL,?,?) ON CONFLICT(user_id,workspace_id) DO UPDATE SET refresh_token_ciphertext=excluded.refresh_token_ciphertext,sync_token=NULL,last_sync_at=NULL,updated_at=excluded.updated_at")
    .bind(crypto.randomUUID(), user.id, row.workspace_id, encrypted, now, now).run();
  return redirect(request, env, "connected");
}

async function accessToken(env: CalendarEnv, connection: { refresh_token_ciphertext: string }): Promise<string> {
  const refreshToken = await decryptToken(connection.refresh_token_ciphertext, env.SESSION_SECRET!);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  if (!response.ok) throw new Error("GOOGLE_TOKEN_REFRESH_FAILED");
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("GOOGLE_ACCESS_TOKEN_MISSING");
  return payload.access_token;
}
function localDateStart(dateValue: string, timezone: string): Date {
  const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(NaN);
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let guess = target;
  for (let index = 0; index < 3; index++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const part = (type: string) => Number(parts.find(item => item.type === type)?.value ?? 0);
    const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    const next = guess + target - represented;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
function eventTime(value: { dateTime?: string; date?: string } | undefined, isEnd: boolean, timezone: string): string | null {
  if (value?.dateTime) { const date = new Date(value.dateTime); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
  if (value?.date && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    const date = localDateStart(value.date, timezone);
    if (isEnd) date.setTime(date.getTime() - 1);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
type GoogleEvent = { id: string; status?: string; summary?: string; description?: string; created?: string; creator?: { email?: string; displayName?: string }; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string }; updated?: string };
async function syncWorkspace(request: Request, env: CalendarEnv, userId: string): Promise<Response> {
  const db = env.DB!;
  if (!sameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const body = await request.json().catch(() => null) as { workspaceId?: unknown } | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!workspaceId || !["owner", "editor"].includes((await workspaceRole(db, workspaceId, userId)) ?? "")) return json({ error: "WORKSPACE_FORBIDDEN" }, 403);
  const connection = await db.prepare("SELECT id,calendar_id,refresh_token_ciphertext,sync_token FROM google_calendar_connections WHERE user_id=? AND workspace_id=?")
    .bind(userId, workspaceId).first<{ id: string; calendar_id: string; refresh_token_ciphertext: string | null; sync_token: string | null }>();
  if (!connection?.refresh_token_ciphertext) return json({ error: "GOOGLE_CALENDAR_NOT_CONNECTED" }, 409);
  const rate = await consumeRateLimit(db, "google-calendar:sync:" + userId, 3, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  let token: string;
  try { token = await accessToken(env, { refresh_token_ciphertext: connection.refresh_token_ciphertext }); }
  catch { return json({ error: "GOOGLE_TOKEN_REFRESH_FAILED", message: "Reconnect Google Calendar to continue." }, 502); }

  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let syncToken = connection.sync_token ?? undefined;
  let imported = 0, updated = 0, deleted = 0, skipped = 0;
  let reset = false;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ maxResults: "2500", showDeleted: "true", singleEvents: "true" });
    if (syncToken) params.set("syncToken", syncToken);
    if (pageToken) params.set("pageToken", pageToken);
    let response = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(connection.calendar_id) + "/events?" + params.toString(), { headers: { authorization: "Bearer " + token } });
    if (response.status === 410 && syncToken && !reset) {
      const stale = await db.prepare("SELECT local_event_id FROM google_calendar_event_map WHERE workspace_id=? AND calendar_id=?")
        .bind(workspaceId, connection.calendar_id).all<{ local_event_id: string }>();
      const resetAt = new Date().toISOString();
      for (const mapped of stale.results) {
        await db.prepare("UPDATE calendar_events SET deleted_at=?,updated_at=?,updated_by_user_id=?,version=version+1 WHERE id=? AND deleted_at IS NULL")
          .bind(resetAt, resetAt, userId, mapped.local_event_id).run();
      }
      await db.prepare("DELETE FROM google_calendar_event_map WHERE workspace_id=? AND calendar_id=?")
        .bind(workspaceId, connection.calendar_id).run();
      syncToken = undefined; pageToken = undefined; nextSyncToken = undefined; reset = true; page = -1; continue;
    }
    if (!response.ok) return json({ error: "GOOGLE_CALENDAR_API_FAILED", status: response.status }, 502);
    const payload = await response.json() as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
    for (const item of payload.items ?? []) {
      if (!item.id) { skipped++; continue; }
      const mapped = await db.prepare("SELECT local_event_id FROM google_calendar_event_map WHERE workspace_id=? AND calendar_id=? AND google_event_id=?")
        .bind(workspaceId, connection.calendar_id, item.id).first<{ local_event_id: string }>();
      const now = new Date().toISOString();
      if (item.status === "cancelled") {
        if (mapped) {
          const result = await db.prepare("UPDATE calendar_events SET deleted_at=?,updated_at=?,updated_by_user_id=?,version=version+1 WHERE id=? AND deleted_at IS NULL")
            .bind(now, now, userId, mapped.local_event_id).run();
          if (Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0)) deleted++;
        }
        continue;
      }
      const timezone = item.start?.timeZone ?? item.end?.timeZone ?? TIMEZONE_FALLBACK;
      const startsAt = eventTime(item.start, false, timezone), endsAt = eventTime(item.end, true, timezone);
      const title = (item.summary ?? "Untitled Google Calendar event").trim().slice(0, 200);
      const sourceCreator = item.creator?.displayName ?? item.creator?.email ?? "Google Calendar";
      const sourceCreatedAt = item.created ?? now;
      const sourceUpdatedAt = item.updated ?? now;
      if (!startsAt || !endsAt || endsAt <= startsAt || !title) { skipped++; continue; }
      const allDay = Boolean(item.start?.date);
      if (mapped) {
        const result = await db.prepare("UPDATE calendar_events SET title=?,description=?,starts_at_utc=?,ends_at_utc=?,timezone=?,all_day=?,source_updated_by=?,source_updated_at=?,updated_at=?,updated_by_user_id=?,version=version+1 WHERE id=? AND deleted_at IS NULL")
          .bind(title, (item.description ?? "").slice(0, 5000), startsAt, endsAt, timezone, allDay ? 1 : 0, "Google Calendar", sourceUpdatedAt, now, userId, mapped.local_event_id).run();
        if (Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0)) updated++;
        else skipped++;
      } else {
        const localId = crypto.randomUUID();
        await db.prepare("INSERT INTO calendar_events (id,workspace_id,title,description,starts_at_utc,ends_at_utc,timezone,all_day,linked_note_id,created_by_user_id,updated_by_user_id,source_created_by,source_created_at,source_updated_by,source_updated_at,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,1,?,?)")
          .bind(localId, workspaceId, title, (item.description ?? "").slice(0, 5000), startsAt, endsAt, timezone, allDay ? 1 : 0, userId, userId, sourceCreator, sourceCreatedAt, "Google Calendar", sourceUpdatedAt, now, now).run();
        await db.prepare("INSERT INTO google_calendar_event_map (workspace_id,calendar_id,google_event_id,local_event_id,google_updated_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
          .bind(workspaceId, connection.calendar_id, item.id, localId, item.updated ?? null, now, now).run();
        imported++;
      }
      if (mapped) await db.prepare("UPDATE google_calendar_event_map SET google_updated_at=?,updated_at=? WHERE workspace_id=? AND calendar_id=? AND google_event_id=?")
        .bind(item.updated ?? null, now, workspaceId, connection.calendar_id, item.id).run();
    }
    pageToken = payload.nextPageToken;
    if (!pageToken) { nextSyncToken = payload.nextSyncToken; break; }
  }
  if (pageToken || !nextSyncToken) return json({ error: "GOOGLE_CALENDAR_SYNC_INCOMPLETE" }, 502);
  const now = new Date().toISOString();
  await db.prepare("UPDATE google_calendar_connections SET sync_token=?,last_sync_at=?,updated_at=? WHERE id=?")
    .bind(nextSyncToken, now, now, connection.id).run();
  await db.prepare("INSERT INTO activity_events (id,workspace_id,actor_user_id,event_type,target_type,target_id,metadata_json,created_at) VALUES (?,?,?,'google_calendar.synced','calendar',? ,?,?)")
    .bind(crypto.randomUUID(), workspaceId, userId, connection.calendar_id, JSON.stringify({ imported, updated, deleted, skipped }), now).run();
  return json({ ok: true, imported, updated, deleted, skipped, lastSyncAt: now, reset });
}

async function connectionStatus(request: Request, env: CalendarEnv, userId: string): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceId || !(await workspaceRole(env.DB!, workspaceId, userId))) return json({ error: "NOT_FOUND" }, 404);
  const row = await env.DB!.prepare("SELECT last_sync_at FROM google_calendar_connections WHERE user_id=? AND workspace_id=? AND refresh_token_ciphertext IS NOT NULL")
    .bind(userId, workspaceId).first<{ last_sync_at: string | null }>();
  return json({ connected: Boolean(row), lastSyncAt: row?.last_sync_at ?? null, direction: "google_to_kitanotes", readOnly: true });
}
async function disconnect(request: Request, env: CalendarEnv, userId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const body = await request.json().catch(() => null) as { workspaceId?: unknown } | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!workspaceId || !(await workspaceRole(env.DB!, workspaceId, userId))) return json({ error: "NOT_FOUND" }, 404);
  const connection = await env.DB!.prepare("SELECT refresh_token_ciphertext FROM google_calendar_connections WHERE user_id=? AND workspace_id=?")
    .bind(userId, workspaceId).first<{ refresh_token_ciphertext: string | null }>();
  if (connection?.refresh_token_ciphertext && env.SESSION_SECRET) {
    try {
      const token = await decryptToken(connection.refresh_token_ciphertext, env.SESSION_SECRET);
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    } catch { /* local token removal still proceeds */ }
  }
  await env.DB!.prepare("UPDATE google_calendar_connections SET refresh_token_ciphertext=NULL,sync_token=NULL,last_sync_at=NULL,updated_at=? WHERE user_id=? AND workspace_id=?")
    .bind(new Date().toISOString(), userId, workspaceId).run();
  return json({ ok: true });
}

export async function handleGoogleCalendarRequest(request: Request, env: CalendarEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/auth/google/calendar/connect" && request.method === "GET") return startConnect(request, env);
  if (url.pathname === REDIRECT_PATH && request.method === "GET") return completeConnect(request, env);
  if (!url.pathname.startsWith("/api/google-calendar")) return null;
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  if (url.pathname === "/api/google-calendar/status" && request.method === "GET") return connectionStatus(request, env, user.id);
  if (url.pathname === "/api/google-calendar/sync" && request.method === "POST") return syncWorkspace(request, env, user.id);
  if (url.pathname === "/api/google-calendar/disconnect" && request.method === "POST") return disconnect(request, env, user.id);
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}
