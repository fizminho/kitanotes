import { getCurrentUser, type AuthEnv } from "./auth.ts";
import { readJsonBody } from "./notes.ts";

type Db = NonNullable<AuthEnv["DB"]>;
type Role = "owner" | "editor" | "viewer";
type ReminderRow = {
  id:string; workspace_id:string; event_id:string|null; note_id:string|null; title:string;
  due_at_utc:string; timezone:string; status:"pending"|"delivered"|"cancelled";
  created_by_user_id:string; created_at:string; updated_at:string; delivered_at:string|null; cancelled_at:string|null;
};
function json(data:unknown,status=200):Response {
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
}
function sameOrigin(request:Request):boolean { return request.headers.get("origin")===new URL(request.url).origin; }
function toUtc(value:unknown):string|null {
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date=new Date(value); return Number.isNaN(date.getTime())?null:date.toISOString();
}
function timezone(value:unknown):string|null {
  if(typeof value!=="string"||value.length>64)return null;
  try{new Intl.DateTimeFormat("en-US",{timeZone:value});return value;}catch{return null;}
}
async function roleFor(db:Db,workspaceId:string,userId:string):Promise<Role|null>{
  const row=await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId,userId).first<{role:Role}>();
  return row?.role??null;
}
async function writeWorkspace(db:Db,userId:string,requested:unknown):Promise<string|null>{
  const workspaceId=requested===undefined||requested===null||requested===""?(await db.prepare("SELECT id FROM workspaces WHERE owner_user_id=? AND visibility='private' ORDER BY created_at ASC LIMIT 1").bind(userId).first<{id:string}>())?.id:(typeof requested==="string"&&requested.length<=64?requested:null);
  if(!workspaceId)return null;
  const role=await roleFor(db,workspaceId,userId);
  return role==="owner"||role==="editor"?workspaceId:null;
}
async function linkedResourceExists(db:Db,workspaceId:string,eventId:string|null,noteId:string|null):Promise<boolean>{
  if(eventId){const row=await db.prepare("SELECT id FROM calendar_events WHERE id=? AND workspace_id=? AND deleted_at IS NULL").bind(eventId,workspaceId).first<{id:string}>();if(!row)return false;}
  if(noteId){const row=await db.prepare("SELECT id FROM notes WHERE id=? AND workspace_id=? AND deleted_at IS NULL").bind(noteId,workspaceId).first<{id:string}>();if(!row)return false;}
  return true;
}
function dto(row:ReminderRow){return{id:row.id,workspaceId:row.workspace_id,eventId:row.event_id,noteId:row.note_id,title:row.title,dueAt:row.due_at_utc,timezone:row.timezone,status:row.status,createdBy:row.created_by_user_id,createdAt:row.created_at,updatedAt:row.updated_at,deliveredAt:row.delivered_at,cancelledAt:row.cancelled_at};}
export async function handleRemindersRequest(request:Request,env:AuthEnv):Promise<Response|null>{
  const url=new URL(request.url);
  if(!url.pathname.startsWith("/api/reminders"))return null;
  if(!env.DB)return json({error:"DATABASE_NOT_CONFIGURED"},503);
  const user=await getCurrentUser(request,env);
  if(!user)return json({error:"UNAUTHENTICATED"},401);
  const db=env.DB;
  if(url.pathname==="/api/reminders"&&request.method==="GET"){
    const workspaceId=url.searchParams.get("workspaceId");
    if(workspaceId&&!(await roleFor(db,workspaceId,user.id)))return json({error:"NOT_FOUND"},404);
    const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||50)),sinceValue=url.searchParams.get("updatedSince");
    const since=sinceValue?new Date(sinceValue):null;if(sinceValue&&(!since||Number.isNaN(since.getTime())))return json({error:"INVALID_SYNC_CURSOR"},400);
    const syncNow=new Date().toISOString();
    const result=workspaceId
      ? await db.prepare("SELECT * FROM reminders WHERE workspace_id=? "+(since?"AND updated_at>=? AND updated_at<=? ":"")+"ORDER BY updated_at,due_at_utc DESC LIMIT ?").bind(...[workspaceId,...(since?[since.toISOString(),syncNow]:[]),limit]).all<ReminderRow>()
      : await db.prepare("SELECT r.* FROM reminders r JOIN workspace_members wm ON wm.workspace_id=r.workspace_id WHERE wm.user_id=? "+(since?"AND r.updated_at>=? AND r.updated_at<=? ":"")+"ORDER BY r.updated_at,r.due_at_utc DESC LIMIT ?").bind(...[user.id,...(since?[since.toISOString(),syncNow]:[]),limit]).all<ReminderRow>();
    return json({reminders:result.results.map(dto),nextCursor:syncNow});
  }
  if(url.pathname==="/api/reminders"&&request.method==="POST"){
    if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
    const body=await readJsonBody(request);
    if(!body)return json({error:"INVALID_JSON_BODY"},400);
    const title=typeof body.title==="string"?body.title.trim():"";
    const dueAt=toUtc(body.dueAt);
    const tz=timezone(body.timezone??"Asia/Kuala_Lumpur");
    if(!title||title.length>200||!dueAt||!tz)return json({error:"INVALID_REMINDER"},400);
    const workspaceId=await writeWorkspace(db,user.id,body.workspaceId);
    if(!workspaceId)return json({error:"WORKSPACE_FORBIDDEN"},403);
    const eventId=body.eventId===undefined||body.eventId===null||body.eventId===""?null:(typeof body.eventId==="string"&&body.eventId.length<=64?body.eventId:undefined);
    const noteId=body.noteId===undefined||body.noteId===null||body.noteId===""?null:(typeof body.noteId==="string"&&body.noteId.length<=64?body.noteId:undefined);
    if(eventId===undefined||noteId===undefined||!(await linkedResourceExists(db,workspaceId,eventId,noteId)))return json({error:"INVALID_LINKED_RESOURCE"},400);
    const id=crypto.randomUUID();const now=new Date().toISOString();const idempotencyKey=crypto.randomUUID();
    await db.prepare("INSERT INTO reminders (id,workspace_id,event_id,note_id,title,due_at_utc,timezone,status,idempotency_key,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?)")
      .bind(id,workspaceId,eventId,noteId,title,dueAt,tz,idempotencyKey,user.id,now,now).run();
    const row=await db.prepare("SELECT * FROM reminders WHERE id=?").bind(id).first<ReminderRow>();
    return json({reminder:row?dto(row):null},201);
  }
  const match=url.pathname.match(/^\/api\/reminders\/([^/]+)$/);
  if(match&&request.method==="PATCH"){
    if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
    const id=decodeURIComponent(match[1]);
    const row=await db.prepare("SELECT * FROM reminders WHERE id=?").bind(id).first<ReminderRow>();
    if(!row)return json({error:"NOT_FOUND"},404);
    const role=await roleFor(db,row.workspace_id,user.id);
    if(!role)return json({error:"NOT_FOUND"},404);
    if(role!=="owner"&&role!=="editor")return json({error:"FORBIDDEN"},403);
    if(row.status!=="pending")return json({error:"REMINDER_NOT_PENDING"},409);
    const body=await readJsonBody(request);
    if(!body)return json({error:"INVALID_JSON_BODY"},400);
    const title=body.title===undefined?row.title:(typeof body.title==="string"?body.title.trim():"");
    const dueAt=body.dueAt===undefined?row.due_at_utc:toUtc(body.dueAt);
    const tz=body.timezone===undefined?row.timezone:timezone(body.timezone);
    if(!title||title.length>200||!dueAt||!tz)return json({error:"INVALID_REMINDER"},400);
    const now=new Date().toISOString();
    const result=await db.prepare("UPDATE reminders SET title=?,due_at_utc=?,timezone=?,updated_at=? WHERE id=? AND status='pending'").bind(title,dueAt,tz,now,id).run();
    if(Number((result as {meta?:{changes?:number}}).meta?.changes??0)!==1)return json({error:"REMINDER_NOT_PENDING"},409);
    const updated=await db.prepare("SELECT * FROM reminders WHERE id=?").bind(id).first<ReminderRow>();
    return json({reminder:updated?dto(updated):null});
  }
  if(match&&request.method==="DELETE"){
    if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
    const id=decodeURIComponent(match[1]);
    const row=await db.prepare("SELECT workspace_id,status FROM reminders WHERE id=?").bind(id).first<{workspace_id:string;status:string}>();
    if(!row)return json({error:"NOT_FOUND"},404);
    const role=await roleFor(db,row.workspace_id,user.id);
    if(!role)return json({error:"NOT_FOUND"},404);
    if(role!=="owner"&&role!=="editor")return json({error:"FORBIDDEN"},403);
    if(row.status!=="pending")return json({error:"REMINDER_NOT_PENDING"},409);
    const now=new Date().toISOString();
    await db.prepare("UPDATE reminders SET status='cancelled',cancelled_at=?,updated_at=? WHERE id=? AND status='pending'").bind(now,now,id).run();
    return json({cancelled:true});
  }
  return json({error:"METHOD_NOT_ALLOWED"},405);
}
