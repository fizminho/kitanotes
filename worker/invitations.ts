import { getCurrentUser, type AuthEnv } from "./auth.ts";
import { readJsonBody } from "./notes.ts";

type Db = NonNullable<AuthEnv["DB"]>;
type InvitationRow = {
  id: string; workspace_id: string; invited_email_normalized: string; role: "editor" | "viewer";
  status: "pending" | "accepted" | "expired" | "revoked"; expires_at: string; created_at: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer"
  }});
}
function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function ownerFor(db: Db, workspaceId: string, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?")
    .bind(workspaceId,userId).first<{role:string}>();
  return row?.role === "owner";
}
function invitationUrl(request: Request, env: AuthEnv, token: string): string {
  const base = new URL(env.APP_BASE_URL?.trim() || new URL(request.url).origin);
  const link = new URL("/invite/accept", base);
  link.searchParams.set("token", token);
  return link.toString();
}
async function createInvitation(request: Request, env: AuthEnv, userId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "INVALID_JSON_BODY" }, 400);
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId.length <= 64 ? body.workspaceId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "viewer" || body.role === "editor" ? body.role : null;
  if (!workspaceId || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role) {
    return json({ error: "INVALID_INVITATION" }, 400);
  }
  const db = env.DB!;
  if (!(await ownerFor(db,workspaceId,userId))) return json({ error: "OWNER_PERMISSION_REQUIRED" }, 403);
  const existingMember = await db.prepare("SELECT wm.user_id FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND u.email_normalized=?")
    .bind(workspaceId,email).first<{user_id:string}>();
  if (existingMember) return json({ error: "ALREADY_A_MEMBER" }, 409);
  const checkedAt = new Date().toISOString();
  await db.prepare("UPDATE invitations SET status='expired' WHERE workspace_id=? AND invited_email_normalized=? AND status='pending' AND expires_at<=?")
    .bind(workspaceId,email,checkedAt).run();
  const existingInvite = await db.prepare("SELECT id FROM invitations WHERE workspace_id=? AND invited_email_normalized=? AND status='pending' AND expires_at>?")
    .bind(workspaceId,email,new Date().toISOString()).first<{id:string}>();
  if (existingInvite) return json({ error: "INVITATION_ALREADY_PENDING" }, 409);

  const token = randomToken();
  const id = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await db.prepare("INSERT INTO invitations (id,workspace_id,invited_email_normalized,invited_by_user_id,role,token_hash,status,expires_at,created_at) VALUES (?,?,?,?,?,?,'pending',?,?)")
      .bind(id,workspaceId,email,userId,role,await tokenHash(token),expiresAt,createdAt).run();
  } catch {
    return json({ error: "INVITATION_ALREADY_PENDING" },409);
  }

  const url = invitationUrl(request,env,token);
  const subject = "You've been invited to collaborate on KitaNotes";
  const bodyText = "You have been invited to a KitaNotes workspace as a " + role + ".\n\nOpen this secure, one-time invitation link: " + url + "\n\nThis invitation expires on " + expiresAt + ".";
  const compose = new URL("https://mail.google.com/mail/");
  compose.search = new URLSearchParams({ view:"cm", fs:"1", to:email, su:subject, body:bodyText }).toString();
  return json({
    invitation: { id, workspaceId, email, role, status:"pending", createdAt, expiresAt },
    invitationUrl: url,
    gmailComposeUrl: compose.toString(),
    delivery: "manual_gmail_handoff"
  },201);
}
async function listInvitations(request: Request, env: AuthEnv, userId: string): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceId) return json({ error: "WORKSPACE_REQUIRED" },400);
  const db = env.DB!;
  if (!(await ownerFor(db,workspaceId,userId))) return json({ error: "OWNER_PERMISSION_REQUIRED" },403);
  const result = await db.prepare("SELECT id,workspace_id,invited_email_normalized,role,status,expires_at,created_at FROM invitations WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100")
    .bind(workspaceId).all<InvitationRow>();
  return json({ invitations: result.results.map(row => ({
    id:row.id,workspaceId:row.workspace_id,email:row.invited_email_normalized,role:row.role,
    status:row.status,expiresAt:row.expires_at,createdAt:row.created_at
  })) });
}
async function acceptInvitation(request: Request, env: AuthEnv, userId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" },403);
  const body = await readJsonBody(request);
  const token = typeof body?.token === "string" && body.token.length >= 32 && body.token.length <= 256 ? body.token : "";
  if (!token) return json({ error: "INVALID_INVITATION_TOKEN" },400);
  const db = env.DB!;
  const user = await db.prepare("SELECT email_normalized,email_verified FROM users WHERE id=?")
    .bind(userId).first<{email_normalized:string;email_verified:number}>();
  if (!user || user.email_verified !== 1) return json({ error: "VERIFIED_EMAIL_REQUIRED" },403);
  const hash = await tokenHash(token);
  const now = new Date().toISOString();
  const accepted = await db.prepare("UPDATE invitations SET status='accepted',accepted_by_user_id=?,accepted_at=? WHERE token_hash=? AND invited_email_normalized=? AND status='pending' AND expires_at>? RETURNING workspace_id,role")
    .bind(userId,now,hash,user.email_normalized,now).first<{workspace_id:string;role:"editor"|"viewer"}>();
  if (!accepted) {
    const existing = await db.prepare("SELECT status,expires_at,invited_email_normalized FROM invitations WHERE token_hash=?")
      .bind(hash).first<{status:string;expires_at:string;invited_email_normalized:string}>();
    if (existing?.status === "pending" && existing.expires_at <= now) {
      await db.prepare("UPDATE invitations SET status='expired' WHERE token_hash=? AND status='pending'").bind(hash).run();
      return json({ error: "INVITATION_EXPIRED" },410);
    }
    if (existing && existing.invited_email_normalized !== user.email_normalized) return json({ error: "INVITATION_EMAIL_MISMATCH" },403);
    return json({ error: "INVITATION_INVALID_OR_ALREADY_USED" },400);
  }
  return json({ accepted:true,workspaceId:accepted.workspace_id,role:accepted.role });
}
async function revokeInvitation(request: Request, env: AuthEnv, userId: string, invitationId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" },403);
  const db = env.DB!;
  const invitation = await db.prepare("SELECT workspace_id,status FROM invitations WHERE id=?")
    .bind(invitationId).first<{workspace_id:string;status:string}>();
  if (!invitation || !(await ownerFor(db,invitation.workspace_id,userId))) return json({ error: "NOT_FOUND" },404);
  if (invitation.status !== "pending") return json({ error: "INVITATION_NOT_PENDING" },409);
  await db.prepare("UPDATE invitations SET status='revoked' WHERE id=? AND status='pending'").bind(invitationId).run();
  return json({ revoked:true });
}

export async function handleInvitationsRequest(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/invitations")) return null;
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" },503);
  const user = await getCurrentUser(request,env);
  if (!user) return json({ error: "UNAUTHENTICATED" },401);
  if (url.pathname === "/api/invitations" && request.method === "POST") return createInvitation(request,env,user.id);
  if (url.pathname === "/api/invitations" && request.method === "GET") return listInvitations(request,env,user.id);
  if (url.pathname === "/api/invitations/accept" && request.method === "POST") return acceptInvitation(request,env,user.id);
  const match = url.pathname.match(/^\/api\/invitations\/([^/]+)$/);
  if (match && request.method === "DELETE") return revokeInvitation(request,env,user.id,decodeURIComponent(match[1]));
  return json({ error: "METHOD_NOT_ALLOWED" },405);
}
