import { consumeRateLimit, rateLimitResponse } from "./rate-limit.ts";
import { getCurrentUser, type AuthEnv } from "./auth.ts";
import { readJsonBody } from "./notes.ts";
import { sendPushToUser } from "./push.ts";

type Db = NonNullable<AuthEnv["DB"]>;
type InvitationEnv = AuthEnv & {VAPID_PUBLIC_KEY?:string;VAPID_PRIVATE_KEY?:string;VAPID_SUBJECT?:string};
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
async function logActivity(db: Db, workspaceId: string, actorId: string | null, eventType: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.prepare("INSERT INTO activity_events (id,workspace_id,actor_user_id,event_type,target_type,target_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),workspaceId,actorId,eventType,targetType,targetId,JSON.stringify(metadata),new Date().toISOString()).run();
  } catch { /* activity history is best-effort and must never block the action */ }
}
async function notifyUser(db: Db, userId: string, workspaceId: string | null, type: string, title: string, body: string, resourceType: string | null, resourceId: string | null, key: string): Promise<void> {
  try {
    await db.prepare("INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),userId,workspaceId,type,title,body,resourceType,resourceId,key,new Date().toISOString()).run();
  } catch { /* notification failure must not fail the collaboration action */ }
}
async function workspaceName(db: Db, workspaceId: string): Promise<string> {
  return (await db.prepare("SELECT name FROM workspaces WHERE id=?").bind(workspaceId).first<{name:string}>())?.name ?? "a space";
}
async function displayName(db: Db, userId: string): Promise<string> {
  const row = await db.prepare("SELECT display_name,email FROM users WHERE id=?").bind(userId).first<{display_name:string|null;email:string}>();
  return row?.display_name || row?.email || "Someone";
}
async function pushDisplayName(db:Db,userId:string):Promise<string|null>{
  const row=await db.prepare("SELECT display_name FROM users WHERE id=?").bind(userId).first<{display_name:string|null}>();
  return row?.display_name?.trim()||null;
}
async function memberRole(db: Db, workspaceId: string, userId: string): Promise<string | null> {
  return (await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId,userId).first<{role:string}>())?.role ?? null;
}
async function ownerFor(db: Db, workspaceId: string, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?")
    .bind(workspaceId,userId).first<{role:string}>();
  return row?.role === "owner";
}
function invitationUrl(request: Request, env: InvitationEnv, token: string): string {
  const base = new URL(env.APP_BASE_URL?.trim() || new URL(request.url).origin);
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
    throw new Error("Invitation base URL must use HTTPS outside local development");
  }
  const link = new URL("/invite/accept", base);
  link.searchParams.set("token", token);
  return link.toString();
}
async function createInvitation(request: Request, env: InvitationEnv, userId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "INVALID_JSON_BODY" }, 400);
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId.length <= 64 ? body.workspaceId : "";
  const suppliedEmail = body.openLink===true ? "" : (typeof body.email === "string" ? body.email.trim().toLowerCase() : "");
  const email = suppliedEmail || "*";
  const role = body.role === "viewer" || body.role === "editor" ? body.role : null;
  if (!workspaceId || (email !== "*" && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) || !role) {
    return json({ error: "INVALID_INVITATION" }, 400);
  }
  const db = env.DB!;
  const ownedWorkspace=await db.prepare("SELECT workspace_type,visibility FROM workspaces WHERE id=? AND owner_user_id=?").bind(workspaceId,userId).first<{workspace_type:string;visibility:string}>();
  if (!ownedWorkspace) return json({ error: "OWNER_PERMISSION_REQUIRED" },403);
  if (ownedWorkspace.workspace_type!=="shared" || ownedWorkspace.visibility!=="shared") return json({error:"SHARED_WORKSPACE_REQUIRED"},409);
  const rate = await consumeRateLimit(db, "invitation:create:user:" + userId, 10, 60 * 60 * 1000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  if(email!=="*"){
    const existingMember = await db.prepare("SELECT wm.user_id FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND u.email_normalized=?")
      .bind(workspaceId,email).first<{user_id:string}>();
    if (existingMember) return json({ error: "ALREADY_A_MEMBER" }, 409);
  }
  const checkedAt = new Date().toISOString();
  await db.prepare("UPDATE invitations SET status='expired' WHERE workspace_id=? AND invited_email_normalized=? AND status='pending' AND expires_at<=?")
    .bind(workspaceId,email,checkedAt).run();
  const existingInvite = await db.prepare("SELECT id FROM invitations WHERE workspace_id=? AND invited_email_normalized=? AND status='pending' AND expires_at>?")
    .bind(workspaceId,email,new Date().toISOString()).first<{id:string}>();
  if (existingInvite) return json({ error: "INVITATION_ALREADY_PENDING" }, 409);

  const token = randomToken();
  const url = invitationUrl(request,env,token);
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

  await logActivity(db,workspaceId,userId,"invitation.created","invitation",id,{email,role});
  const subject = "You've been invited to collaborate on KitaNotes";
  const bodyText = "You have been invited to a KitaNotes workspace as a " + role + ".\n\nOpen this secure, one-time invitation link: " + url + "\n\nThis invitation expires on " + expiresAt + ".";
  const compose = email==="*" ? null : new URL("https://mail.google.com/mail/");
  if(compose)compose.search = new URLSearchParams({ view:"cm", fs:"1", to:email, su:subject, body:bodyText }).toString();
  return json({
    invitation: { id, workspaceId, email:email==="*"?"Anyone with link":email, role, status:"pending", createdAt, expiresAt },
    invitationUrl: url,
    gmailComposeUrl: compose?.toString() ?? null,
    delivery: "manual_gmail_handoff"
  },201);
}
async function listInvitations(request: Request, env: InvitationEnv, userId: string): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceId) return json({ error: "WORKSPACE_REQUIRED" },400);
  const db = env.DB!;
  if (!(await ownerFor(db,workspaceId,userId))) return json({ error: "OWNER_PERMISSION_REQUIRED" },403);
  const result = await db.prepare("SELECT id,workspace_id,invited_email_normalized,role,status,expires_at,created_at FROM invitations WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100")
    .bind(workspaceId).all<InvitationRow>();
  return json({ invitations: result.results.map(row => ({
    id:row.id,workspaceId:row.workspace_id,email:row.invited_email_normalized==="*"?"Anyone with link":row.invited_email_normalized,role:row.role,
    status:row.status==="pending"&&row.expires_at<=new Date().toISOString()?"expired":row.status,expiresAt:row.expires_at,createdAt:row.created_at
  })) });
}
async function acceptInvitation(request: Request, env: InvitationEnv, userId: string): Promise<Response> {
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
  const openLink = await db.prepare("SELECT workspace_id,role,expires_at,status FROM invitations WHERE token_hash=? AND invited_email_normalized='*'")
    .bind(hash).first<{workspace_id:string;role:"editor"|"viewer";expires_at:string;status:string}>();
  if(openLink){
    if(openLink.status!=="pending")return json({error:"INVITATION_INVALID_OR_ALREADY_USED"},400);
    if(openLink.expires_at<=now){await db.prepare("UPDATE invitations SET status='expired' WHERE token_hash=? AND status='pending'").bind(hash).run();return json({error:"INVITATION_EXPIRED"},410);}
    const ws=await db.prepare("SELECT visibility,owner_user_id FROM workspaces WHERE id=?").bind(openLink.workspace_id).first<{visibility:string;owner_user_id:string}>();
    if(!ws||ws.visibility!=="shared")return json({error:"WORKSPACE_NOT_SHARED"},410);
    const existingMember=await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(openLink.workspace_id,userId).first<{role:string}>();
    if(!existingMember)await db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,role,joined_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id=? AND visibility='shared')").bind(openLink.workspace_id,userId,openLink.role,now,openLink.workspace_id).run();
    const currentMember=await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(openLink.workspace_id,userId).first<{role:string}>();
    if(!currentMember)return json({error:"WORKSPACE_NOT_SHARED"},410);
    await logActivity(db,openLink.workspace_id,userId,"member.joined","user",userId,{role:openLink.role,via:"invite_link"});
    if(ws.owner_user_id!==userId)await notifyUser(db,ws.owner_user_id,openLink.workspace_id,"invitation_accepted","Invitation accepted",(await displayName(db,userId))+" joined "+(await workspaceName(db,openLink.workspace_id))+" as "+openLink.role+".","workspace",openLink.workspace_id,"invite-link-join:"+openLink.workspace_id+":"+userId);
    if(ws.owner_user_id!==userId)try{await sendPushToUser(db,env,ws.owner_user_id,{kind:"workspace",subtype:"invitation_accepted",actor:await pushDisplayName(db,userId),actorId:userId,workspace:await workspaceName(db,openLink.workspace_id),workspaceId:openLink.workspace_id,resourceType:"workspace",resourceId:openLink.workspace_id,url:"/?workspaceId="+encodeURIComponent(openLink.workspace_id),tag:"workspace:"+openLink.workspace_id+":"+userId,important:true});}catch{/* Push is best-effort. */}
    return json({accepted:true,workspaceId:openLink.workspace_id,role:currentMember.role,alreadyMember:Boolean(existingMember)});
  }
  const accepted = await db.prepare("UPDATE invitations SET status='accepted',accepted_by_user_id=?,accepted_at=? WHERE token_hash=? AND invited_email_normalized=? AND status='pending' AND expires_at>? AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id=invitations.workspace_id AND w.visibility='shared') RETURNING workspace_id,role")
    .bind(userId,now,hash,user.email_normalized,now).first<{workspace_id:string;role:"editor"|"viewer"}>();
  if (!accepted) {
    const existing = await db.prepare("SELECT i.status,i.expires_at,i.invited_email_normalized,w.visibility FROM invitations i LEFT JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=?")
      .bind(hash).first<{status:string;expires_at:string;invited_email_normalized:string;visibility:string|null}>();
    if(existing&&existing.visibility!=="shared")return json({error:"WORKSPACE_NOT_SHARED"},410);
    if (existing?.status === "pending" && existing.expires_at <= now) {
      await db.prepare("UPDATE invitations SET status='expired' WHERE token_hash=? AND status='pending'").bind(hash).run();
      return json({ error: "INVITATION_EXPIRED" },410);
    }
    if (existing && existing.invited_email_normalized !== user.email_normalized) return json({ error: "INVITATION_EMAIL_MISMATCH" },403);
    return json({ error: "INVITATION_INVALID_OR_ALREADY_USED" },400);
  }
  await logActivity(db,accepted.workspace_id,userId,"member.joined","user",userId,{role:accepted.role});
  const ownerRow = await db.prepare("SELECT owner_user_id FROM workspaces WHERE id=?").bind(accepted.workspace_id).first<{owner_user_id:string}>();
  if (ownerRow && ownerRow.owner_user_id !== userId) {
    await notifyUser(db,ownerRow.owner_user_id,accepted.workspace_id,"invitation_accepted","Invitation accepted",(await displayName(db,userId))+" joined "+(await workspaceName(db,accepted.workspace_id))+" as "+accepted.role+".","workspace",accepted.workspace_id,"invitation_accepted:"+accepted.workspace_id+":"+userId+":"+now);
    try{await sendPushToUser(db,env,ownerRow.owner_user_id,{kind:"workspace",subtype:"invitation_accepted",actor:await pushDisplayName(db,userId),actorId:userId,workspace:await workspaceName(db,accepted.workspace_id),workspaceId:accepted.workspace_id,resourceType:"workspace",resourceId:accepted.workspace_id,url:"/?workspaceId="+encodeURIComponent(accepted.workspace_id),tag:"workspace:"+accepted.workspace_id+":"+userId,important:true});}catch{/* Push is best-effort. */}
  }
  return json({ accepted:true,workspaceId:accepted.workspace_id,role:accepted.role });
}
async function revokeInvitation(request: Request, env: InvitationEnv, userId: string, invitationId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" },403);
  const db = env.DB!;
  const invitation = await db.prepare("SELECT workspace_id,status FROM invitations WHERE id=?")
    .bind(invitationId).first<{workspace_id:string;status:string}>();
  if (!invitation || !(await ownerFor(db,invitation.workspace_id,userId))) return json({ error: "NOT_FOUND" },404);
  if (invitation.status !== "pending") return json({ error: "INVITATION_NOT_PENDING" },409);
  await db.prepare("UPDATE invitations SET status='revoked' WHERE id=? AND status='pending'").bind(invitationId).run();
  await logActivity(db,invitation.workspace_id,userId,"invitation.revoked","invitation",invitationId);
  return json({ revoked:true });
}


async function listMembers(env: InvitationEnv, userId: string, workspaceId: string): Promise<Response> {
  const db = env.DB!;
  if (!(await memberRole(db,workspaceId,userId))) return json({ error:"NOT_FOUND" },404);
  const now=new Date().getTime();
  const result = await db.prepare("SELECT wm.user_id,wm.role,wm.joined_at,u.email,u.display_name,p.last_seen_at FROM workspace_members wm JOIN users u ON u.id=wm.user_id LEFT JOIN workspace_presence p ON p.workspace_id=wm.workspace_id AND p.user_id=wm.user_id WHERE wm.workspace_id=? ORDER BY CASE WHEN wm.role='owner' THEN 0 ELSE 1 END,u.email_normalized")
    .bind(workspaceId).all<{user_id:string;role:"owner"|"editor"|"viewer";joined_at:string;email:string;display_name:string|null;last_seen_at:string|null}>();
  return json({ members:result.results.map(row=>({userId:row.user_id,email:row.email,displayName:row.display_name,role:row.role,joinedAt:row.joined_at,lastSeenAt:row.last_seen_at,isOnline:Boolean(row.last_seen_at&&now-new Date(row.last_seen_at).getTime()<90000)})) });
}
async function updateMemberRole(request: Request, env: InvitationEnv, userId: string, workspaceId: string, memberId: string): Promise<Response> {
  if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const body=await readJsonBody(request);
  const role=body?.role==="editor"||body?.role==="viewer"?body.role:null;
  if(!role)return json({error:"INVALID_MEMBER_ROLE"},400);
  const db=env.DB!;
  if(!(await ownerFor(db,workspaceId,userId)))return json({error:"OWNER_PERMISSION_REQUIRED"},403);
  const member=await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId,memberId).first<{role:string}>();
  if(!member||member.role==="owner")return json({error:"MEMBER_NOT_FOUND"},404);
  await db.prepare("UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=? AND role<>'owner'").bind(role,workspaceId,memberId).run();
  if (member.role !== role) {
    await logActivity(db,workspaceId,userId,"member.role_changed","user",memberId,{from:member.role,to:role});
    await notifyUser(db,memberId,workspaceId,"member_role_changed","Your permission changed","You are now "+(role==="editor"?"an editor":"a viewer")+" in "+(await workspaceName(db,workspaceId))+".","workspace",workspaceId,"role_changed:"+workspaceId+":"+memberId+":"+role+":"+Date.now());
    try{await sendPushToUser(db,env,memberId,{kind:"workspace",subtype:"role_changed",workspace:await workspaceName(db,workspaceId),role,workspaceId,resourceType:"workspace",resourceId:workspaceId,url:"/?workspaceId="+encodeURIComponent(workspaceId),tag:"workspace:"+workspaceId+":"+memberId,important:true});}catch{/* Push is best-effort. */}
  }
  return json({updated:true,role});
}

async function removeMember(request: Request, env: InvitationEnv, userId: string, workspaceId: string, memberId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const db=env.DB!;
  if (!(await ownerFor(db,workspaceId,userId))) return json({error:"OWNER_PERMISSION_REQUIRED"},403);
  if(memberId===userId) return json({error:"OWNER_CANNOT_REMOVE_SELF"},409);
  const member=await db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id=? AND user_id=? AND role<>'owner'").bind(workspaceId,memberId).first<{user_id:string}>();
  if(!member)return json({error:"MEMBER_NOT_FOUND"},404);
  const spaceName = await workspaceName(db,workspaceId);
  await db.prepare("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=? AND role<>'owner'").bind(workspaceId,memberId).run();
  await logActivity(db,workspaceId,userId,"member.removed","user",memberId);
  await notifyUser(db,memberId,null,"member_removed","Removed from a shared space","You no longer have access to "+spaceName+".","workspace",workspaceId,"member_removed:"+workspaceId+":"+memberId+":"+Date.now());
  try{await sendPushToUser(db,env,memberId,{kind:"workspace",subtype:"member_removed",workspace:spaceName,workspaceId,resourceType:"workspace",resourceId:workspaceId,url:"/",tag:"workspace:"+workspaceId+":"+memberId,important:true});}catch{/* Push is best-effort. */}
  return json({removed:true});
}

async function leaveWorkspace(request: Request, env: InvitationEnv, userId: string, workspaceId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const result=await env.DB!.prepare("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=? AND role<>'owner'").bind(workspaceId,userId).run();
  const changed=Number((result as {meta?:{changes?:number}})?.meta?.changes ?? 0);
  if(!changed) return json({error:"CANNOT_LEAVE_WORKSPACE"},409);
  const db=env.DB!;
  await logActivity(db,workspaceId,userId,"member.left","user",userId);
  const ownerRow = await db.prepare("SELECT owner_user_id FROM workspaces WHERE id=?").bind(workspaceId).first<{owner_user_id:string}>();
  if (ownerRow) await notifyUser(db,ownerRow.owner_user_id,workspaceId,"member_left","A member left",(await displayName(db,userId))+" left "+(await workspaceName(db,workspaceId))+".","workspace",workspaceId,"member_left:"+workspaceId+":"+userId+":"+Date.now());
  if (ownerRow) try{await sendPushToUser(db,env,ownerRow.owner_user_id,{kind:"workspace",subtype:"member_left",actor:await pushDisplayName(db,userId),actorId:userId,workspace:await workspaceName(db,workspaceId),workspaceId,resourceType:"workspace",resourceId:workspaceId,url:"/?workspaceId="+encodeURIComponent(workspaceId),tag:"workspace:"+workspaceId+":"+userId,important:true});}catch{/* Push is best-effort. */}
  return json({left:true});
}
async function deleteWorkspace(request: Request, env: InvitationEnv, userId: string, workspaceId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const workspace=await env.DB!.prepare("SELECT id FROM workspaces WHERE id=? AND owner_user_id=? AND workspace_type='shared' AND visibility='shared'").bind(workspaceId,userId).first<{id:string}>();
  if(!workspace) return json({error:"SHARED_WORKSPACE_NOT_FOUND"},404);
  await env.DB!.prepare("DELETE FROM workspaces WHERE id=? AND owner_user_id=? AND workspace_type='shared' AND visibility='shared'").bind(workspaceId,userId).run();
  return json({deleted:true});
}

async function workspaceSummary(env:InvitationEnv,userId:string,workspaceId:string):Promise<Response>{
  const db=env.DB!;
  if(!(await memberRole(db,workspaceId,userId)))return json({error:"NOT_FOUND"},404);
  const [notes,events,members,pending]=await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM notes WHERE workspace_id=? AND deleted_at IS NULL").bind(workspaceId).first<{total:number}>(),
    db.prepare("SELECT COUNT(*) AS total FROM calendar_events WHERE workspace_id=? AND deleted_at IS NULL").bind(workspaceId).first<{total:number}>(),
    db.prepare("SELECT COUNT(*) AS total FROM workspace_members WHERE workspace_id=?").bind(workspaceId).first<{total:number}>(),
    db.prepare("SELECT COUNT(*) AS total FROM invitations WHERE workspace_id=? AND status='pending' AND expires_at>?").bind(workspaceId,new Date().toISOString()).first<{total:number}>()
  ]);
  return json({notes:notes?.total??0,events:events?.total??0,members:members?.total??0,pendingInvitations:pending?.total??0});
}

async function listActivity(request:Request,env: InvitationEnv, userId: string, workspaceId: string): Promise<Response> {
  const db = env.DB!;
  if (!(await memberRole(db,workspaceId,userId))) return json({ error:"NOT_FOUND" },404);
  const url=new URL(request.url);
  const type=(url.searchParams.get("type")??"").slice(0,64);
  const actor=(url.searchParams.get("actor")??"").slice(0,64);
  const before=(url.searchParams.get("before")??"").slice(0,120);
  const [beforeDate,beforeId]=before.split("|");
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||50));
  const result = await db.prepare("SELECT a.id,a.event_type,a.target_type,a.target_id,a.metadata_json,a.created_at,a.actor_user_id,u.display_name AS actor_name,COALESCE(t.display_name,n.title,e.title) AS target_name FROM activity_events a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN users t ON a.target_type='user' AND t.id=a.target_id LEFT JOIN notes n ON a.target_type='note' AND n.id=a.target_id LEFT JOIN calendar_events e ON a.target_type='event' AND e.id=a.target_id WHERE a.workspace_id=? AND (?='' OR a.event_type=?) AND (?='' OR a.actor_user_id=?) AND (?='' OR a.created_at<? OR (a.created_at=? AND a.id<?)) ORDER BY a.created_at DESC,a.id DESC LIMIT ?")
    .bind(workspaceId,type,type,actor,actor,beforeDate??"",beforeDate??"",beforeDate??"",beforeId??"",limit+1).all<{id:string;event_type:string;target_type:string;target_id:string;metadata_json:string;created_at:string;actor_user_id:string|null;actor_name:string|null;target_name:string|null}>();
  const hasMore=result.results.length>limit;
  const rows=result.results.slice(0,limit);
  return json({activity:rows.map(row=>{
    let metadata:Record<string,unknown>={};try{metadata=JSON.parse(row.metadata_json);}catch{/* ignore malformed metadata */}
    delete metadata.email;
    return{id:row.id,type:row.event_type,actor:row.actor_name||"Workspace member",actorId:row.actor_user_id,target:row.target_name||null,metadata,createdAt:row.created_at};
  }),nextCursor:hasMore?(rows[rows.length-1]?.created_at??"")+"|"+(rows[rows.length-1]?.id??""):null});
}

async function listWorkspaces(request:Request,env:InvitationEnv,userId:string):Promise<Response>{
  const url=new URL(request.url),sinceValue=url.searchParams.get("updatedSince");
  const syncNow=new Date().toISOString();
  const preference=await env.DB!.prepare("SELECT p.starred_workspace_id FROM user_workspace_preferences p JOIN workspace_members wm ON wm.workspace_id=p.starred_workspace_id AND wm.user_id=p.user_id WHERE p.user_id=?").bind(userId).first<{starred_workspace_id:string|null}>();
  const baseSql="SELECT w.id,w.name,w.workspace_type,w.visibility,w.color,w.icon,wm.role FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE wm.user_id=?";
  if(sinceValue){
    const parsed=new Date(sinceValue);if(Number.isNaN(parsed.getTime()))return json({error:"INVALID_SYNC_CURSOR"},400);
    const since=parsed.toISOString();
    const result=await env.DB!.prepare(baseSql+" AND (w.updated_at>=? OR w.id IN (SELECT workspace_id FROM workspace_membership_changes WHERE user_id=? AND changed_at>=? AND changed_at<=?)) ORDER BY w.name COLLATE NOCASE").bind(userId,since,userId,since,syncNow).all<{id:string;name:string;workspace_type:"shared";visibility:"private"|"shared";color:string;icon:string;role:"owner"|"editor"|"viewer"}>();
    const removed=await env.DB!.prepare("SELECT DISTINCT c.workspace_id FROM workspace_membership_changes c WHERE c.user_id=? AND c.active=0 AND c.changed_at>? AND c.changed_at<=? AND NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=c.workspace_id AND wm.user_id=c.user_id)").bind(userId,since,syncNow).all<{workspace_id:string}>();
    return json({workspaces:result.results.map(row=>({id:row.id,name:row.name,type:"shared" as const,visibility:row.visibility,color:row.color??null,icon:row.icon??"📁",role:row.role})),removedWorkspaceIds:removed.results.map(row=>row.workspace_id),starredWorkspaceId:preference?.starred_workspace_id??null,nextCursor:syncNow});
  }
  const result=await env.DB!.prepare(baseSql+" ORDER BY CASE WHEN w.id=(SELECT starred_workspace_id FROM user_workspace_preferences WHERE user_id=?) THEN 0 ELSE 1 END,CASE WHEN w.visibility='private' THEN 0 ELSE 1 END,w.name COLLATE NOCASE").bind(userId,userId).all<{id:string;name:string;workspace_type:"shared";visibility:"private"|"shared";color:string;icon:string;role:"owner"|"editor"|"viewer"}>();
  return json({workspaces:result.results.map(row=>({id:row.id,name:row.name,type:"shared" as const,visibility:row.visibility,color:row.color??null,icon:row.icon??"📁",role:row.role})),starredWorkspaceId:preference?.starred_workspace_id??null,nextCursor:syncNow});
}

async function updateStarredWorkspace(request: Request, env: InvitationEnv, userId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const body=await readJsonBody(request);
  if (!body || (body.workspaceId!==null && (typeof body.workspaceId!=="string" || body.workspaceId.length>64))) {
    return json({error:"INVALID_WORKSPACE"},400);
  }
  const workspaceId=body.workspaceId as string|null;
  if(workspaceId){
    const membership=await env.DB!.prepare("SELECT workspace_id FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId,userId).first<{workspace_id:string}>();
    if(!membership)return json({error:"WORKSPACE_NOT_FOUND"},404);
  }
  await env.DB!.prepare(
    "INSERT INTO user_workspace_preferences (user_id,starred_workspace_id,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET starred_workspace_id=excluded.starred_workspace_id,updated_at=excluded.updated_at"
  ).bind(userId,workspaceId,new Date().toISOString()).run();
  return json({starredWorkspaceId:workspaceId});
}

async function invitationPreview(request:Request,env:InvitationEnv):Promise<Response>{
  const token=new URL(request.url).searchParams.get("token")??"";
  if(token.length<32||token.length>256)return json({valid:false,error:"INVALID_INVITATION_TOKEN"},400);
  const hash=await tokenHash(token);
  const row=await env.DB!.prepare("SELECT i.workspace_id,i.role,i.status,i.expires_at,w.name AS workspace_name,w.visibility,u.display_name AS inviter_name FROM invitations i JOIN workspaces w ON w.id=i.workspace_id LEFT JOIN users u ON u.id=i.invited_by_user_id WHERE i.token_hash=?")
    .bind(hash).first<{workspace_id:string;role:"editor"|"viewer";status:string;expires_at:string;workspace_name:string;visibility:string;inviter_name:string|null}>();
  if(!row)return json({valid:false,error:"INVITATION_INVALID"});
  if(row.visibility!=="shared")return json({valid:false,error:"WORKSPACE_NOT_SHARED"});
  if(row.status!=="pending")return json({valid:false,error:row.status==="revoked"?"INVITATION_REVOKED":"INVITATION_ALREADY_USED",workspaceName:row.workspace_name,inviterName:row.inviter_name||"the workspace owner"});
  if(row.expires_at<=new Date().toISOString())return json({valid:false,error:"INVITATION_EXPIRED",workspaceName:row.workspace_name,inviterName:row.inviter_name||"the workspace owner"},410);
  const count=await env.DB!.prepare("SELECT COUNT(*) AS total FROM workspace_members WHERE workspace_id=?").bind(row.workspace_id).first<{total:number}>();
  return json({valid:true,workspaceName:row.workspace_name,inviterName:row.inviter_name||"A workspace member",role:row.role,memberCount:count?.total??0,expiresAt:row.expires_at});
}

export async function handleInvitationsRequest(request: Request, env: InvitationEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/workspaces" && !url.pathname.startsWith("/api/workspaces/") && !url.pathname.startsWith("/api/invitations")) return null;
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" },503);
  if(url.pathname==="/api/invitations/preview"&&request.method==="GET")return invitationPreview(request,env);
  const user = await getCurrentUser(request,env);
  if (!user) return json({ error: "UNAUTHENTICATED" },401);
  if (url.pathname === "/api/workspaces" && request.method === "GET") return listWorkspaces(request,env,user.id);
  if (url.pathname === "/api/workspaces/star" && request.method === "PUT") return updateStarredWorkspace(request,env,user.id);
  if (url.pathname === "/api/workspaces" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" },403);
    const body = await readJsonBody(request);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60) return json({ error: "INVALID_WORKSPACE_NAME" },400);
    const count = await env.DB!.prepare("SELECT COUNT(*) AS total FROM workspaces WHERE owner_user_id=? AND workspace_type='shared' AND visibility='shared'").bind(user.id).first<{total:number}>();
    if ((count?.total ?? 0) >= 30) return json({ error: "WORKSPACE_LIMIT_REACHED" },409);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB!.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES (?,?,?,'shared','shared',?,?)").bind(id,name,user.id,now,now).run();
    await env.DB!.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES (?,?,'owner',?)").bind(id,user.id,now).run();
    return json({ workspace: { id,name,type:"shared",visibility:"shared",role:"owner" } },201);
  }
  const workspaceMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)(?:\/(?:members(?:\/([^/]+))?|activity|summary|appearance|presence))?$/);
  if (workspaceMatch) {
    const id=decodeURIComponent(workspaceMatch[1]);
    if(request.method==="PUT"&&url.pathname.endsWith("/appearance")){
      if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
      const body=await readJsonBody(request),color=body?.color,icon=body?.icon;
      const allowedIcons=["📁","👥","💼","🏠","❤️","📚","📅","⭐","🎓","🛒"];
      if(typeof color!=="string"||!/^#[0-9a-fA-F]{6}$/.test(color)||typeof icon!=="string"||!allowedIcons.includes(icon))return json({error:"INVALID_WORKSPACE_APPEARANCE"},400);
      const owner=await env.DB!.prepare("SELECT id FROM workspaces WHERE id=? AND owner_user_id=?").bind(id,user.id).first<{id:string}>();
      if(!owner)return json({error:"FORBIDDEN"},403);
      const now=new Date().toISOString();
      await env.DB!.prepare("UPDATE workspaces SET color=?,icon=?,updated_at=? WHERE id=?").bind(color,icon,now,id).run();
      await logActivity(env.DB!,id,user.id,"workspace.appearance_updated","workspace",id);
      return json({ok:true,color,icon,updatedAt:now});
    }
    if(request.method==="POST"&&url.pathname.endsWith("/presence")){
      if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
      const member=await env.DB!.prepare("SELECT workspace_id FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(id,user.id).first<{workspace_id:string}>();
      if(!member)return json({error:"NOT_FOUND"},404);
      const now=new Date().toISOString();
      await env.DB!.prepare("INSERT INTO workspace_presence(workspace_id,user_id,last_seen_at) VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at").bind(id,user.id,now).run();
      return json({ok:true,lastSeenAt:now});
    }
    if(request.method==="GET" && url.pathname.endsWith("/members")) return listMembers(env,user.id,id);
    if(request.method==="GET" && url.pathname.endsWith("/summary")) return workspaceSummary(env,user.id,id);
    if(request.method==="PATCH" && url.pathname.includes("/members/")) return updateMemberRole(request,env,user.id,id,decodeURIComponent(url.pathname.split("/").pop()??""));
    if(request.method==="DELETE" && url.pathname.includes("/members/")) {
      const memberId=decodeURIComponent(url.pathname.split("/").pop()??"");
      if(memberId===user.id) return leaveWorkspace(request,env,user.id,id);
      return removeMember(request,env,user.id,id,memberId);
    }
    if(request.method==="GET" && url.pathname.endsWith("/activity")) return listActivity(request,env,user.id,id);
    if(request.method==="DELETE" && !url.pathname.includes("/members")) return deleteWorkspace(request,env,user.id,id);
    if(request.method==="PATCH") {
      if(!sameOrigin(request)) return json({error:"CSRF_ORIGIN_REJECTED"},403);
      const body=await readJsonBody(request);
      if(body?.action==="make_shared") {
        const workspace=await env.DB!.prepare("SELECT id FROM workspaces WHERE id=? AND owner_user_id=? AND workspace_type='shared' AND visibility='private'").bind(id,user.id).first<{id:string}>();
        if(!workspace) return json({error:"PRIVATE_WORKSPACE_NOT_FOUND"},404);
        const now=new Date().toISOString();
        await env.DB!.prepare("UPDATE workspaces SET visibility='shared',updated_at=? WHERE id=? AND owner_user_id=?").bind(now,id,user.id).run();
        await logActivity(env.DB!,id,user.id,"workspace.made_shared","workspace",id);
        return json({updated:true,id,type:"shared",visibility:"shared"});
      }
      if(body?.action==="make_private") {
        const workspace=await env.DB!.prepare("SELECT id,workspace_type,visibility FROM workspaces WHERE id=? AND owner_user_id=? AND workspace_type='shared' AND visibility='shared'").bind(id,user.id).first<{id:string;workspace_type:string;visibility:string}>();
        if(!workspace) return json({error:"SHARED_WORKSPACE_NOT_FOUND"},404);
        const now=new Date().toISOString();
        // Change visibility first as an atomic ownership-checked claim. The
        // remaining cleanup only runs while this user still owns the private space.
        const privacyChanges = [
          env.DB!.prepare("UPDATE workspaces SET visibility='private',updated_at=? WHERE id=? AND owner_user_id=? AND workspace_type='shared' AND visibility='shared'")
            .bind(now,id,user.id),
          env.DB!.prepare("UPDATE invitations SET status='revoked' WHERE workspace_id=? AND status='pending' AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND owner_user_id=? AND visibility='private')")
            .bind(id,id,user.id),
          env.DB!.prepare("DELETE FROM workspace_members WHERE workspace_id=? AND user_id<>? AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND owner_user_id=? AND visibility='private')")
            .bind(id,user.id,id,user.id)
        ];
        let privacyResults;
        if (env.DB!.batch) {
          privacyResults = await env.DB!.batch(privacyChanges);
        } else {
          const claimed = await privacyChanges[0].run();
          privacyResults = [claimed];
          if (Number((claimed as {meta?:{changes?:number}})?.meta?.changes ?? 0) > 0) {
            privacyResults.push(await privacyChanges[1].run(), await privacyChanges[2].run());
          }
        }
        const claimed = Number((privacyResults[0] as {meta?:{changes?:number}})?.meta?.changes ?? 0);
        if (claimed !== 1) return json({error:"WORKSPACE_UPDATE_CONFLICT"},409);
        await logActivity(env.DB!,id,user.id,"workspace.members_cleared","workspace",id);
        return json({updated:true,id,type:"shared",visibility:"private",membersRemoved:true,invitationsRevoked:true});
      }
      if(body?.action==="transfer_ownership") {
        const targetId=typeof body.userId==="string"?body.userId:"";
        const ws=await env.DB!.prepare("SELECT id FROM workspaces WHERE id=? AND owner_user_id=? AND workspace_type='shared' AND visibility='shared'").bind(id,user.id).first<{id:string}>();
        if(!ws) return json({error:"SHARED_WORKSPACE_NOT_FOUND"},404);
        if(!targetId||targetId===user.id||!(await memberRole(env.DB!,id,targetId))) return json({error:"MEMBER_NOT_FOUND"},404);
        const now=new Date().toISOString();
        // Claim the transfer with an owner-checked update first. D1 batch is
        // transactional, so competing transfers cannot both promote a target.
        const ownershipChanges = [
          env.DB!.prepare("UPDATE workspaces SET owner_user_id=?,updated_at=? WHERE id=? AND owner_user_id=? AND workspace_type='shared' AND visibility='shared' AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND role<>'owner')")
            .bind(targetId,now,id,user.id,id,targetId),
          env.DB!.prepare("UPDATE workspace_members SET role='editor' WHERE workspace_id=? AND user_id=? AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND owner_user_id=?)")
            .bind(id,user.id,id,targetId),
          env.DB!.prepare("UPDATE workspace_members SET role='owner' WHERE workspace_id=? AND user_id=? AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND owner_user_id=?)")
            .bind(id,targetId,id,targetId)
        ];
        let transferResults;
        if (env.DB!.batch) {
          transferResults = await env.DB!.batch(ownershipChanges);
        } else {
          const claimed = await ownershipChanges[0].run();
          transferResults = [claimed];
          if (Number((claimed as {meta?:{changes?:number}})?.meta?.changes ?? 0) > 0) {
            transferResults.push(await ownershipChanges[1].run(), await ownershipChanges[2].run());
          }
        }
        const claimed = Number((transferResults[0] as {meta?:{changes?:number}})?.meta?.changes ?? 0);
        if (claimed !== 1) return json({error:"OWNERSHIP_TRANSFER_CONFLICT"},409);
        await logActivity(env.DB!,id,user.id,"workspace.ownership_transferred","user",targetId);
        await notifyUser(env.DB!,targetId,id,"ownership_transferred","You now own a space",(await displayName(env.DB!,user.id))+" made you the owner of "+(await workspaceName(env.DB!,id))+".","workspace",id,"ownership:"+id+":"+targetId+":"+Date.now());
        try{await sendPushToUser(env.DB!,env,targetId,{kind:"workspace",subtype:"ownership_transferred",workspace:await workspaceName(env.DB!,id),workspaceId:id,resourceType:"workspace",resourceId:id,url:"/?workspaceId="+encodeURIComponent(id),tag:"workspace:"+id+":"+targetId,important:true});}catch{/* Push is best-effort. */}
        return json({updated:true,ownerUserId:targetId});
      }
      const name=typeof body?.name==="string"?body.name.trim():"";
      if(!name||name.length>60)return json({error:"INVALID_WORKSPACE_NAME"},400);
      const owned=await env.DB!.prepare("SELECT id FROM workspaces WHERE id=? AND owner_user_id=?").bind(id,user.id).first<{id:string}>();
      if(!owned)return json({error:"WORKSPACE_NOT_FOUND"},404);
      await env.DB!.prepare("UPDATE workspaces SET name=?,updated_at=? WHERE id=?").bind(name,new Date().toISOString(),id).run();
      return json({updated:true,id,name});
    }
  }
  if (url.pathname === "/api/invitations" && request.method === "POST") return createInvitation(request,env,user.id);
  if (url.pathname === "/api/invitations" && request.method === "GET") return listInvitations(request,env,user.id);
  if (url.pathname === "/api/invitations/accept" && request.method === "POST") return acceptInvitation(request,env,user.id);
  const match = url.pathname.match(/^\/api\/invitations\/([^/]+)$/);
  if (match && request.method === "DELETE") return revokeInvitation(request,env,user.id,decodeURIComponent(match[1]));
  return json({ error: "METHOD_NOT_ALLOWED" },405);
}
