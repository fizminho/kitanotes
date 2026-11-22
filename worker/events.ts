import { getCurrentUser, type AuthEnv } from "./auth.ts";
import { readJsonBody } from "./notes.ts";

type Db = NonNullable<AuthEnv["DB"]>;
type Role = "owner" | "editor" | "viewer";
type EventRow = {
  id:string; workspace_id:string; title:string; description:string; starts_at_utc:string; ends_at_utc:string;
  timezone:string; all_day:number; linked_note_id:string|null; created_by_user_id:string; version:number;
  created_at:string; updated_at:string; deleted_at:string|null;
};

function json(data:unknown,status=200):Response {
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
}
function sameOrigin(request:Request):boolean { return request.headers.get("origin")===new URL(request.url).origin; }
function validTimezone(value:unknown):string|null {
  if(typeof value!=="string" || value.length>64) return null;
  try { new Intl.DateTimeFormat("en-US",{timeZone:value}); return value; } catch { return null; }
}
function toUtc(value:unknown):string|null {
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?null:date.toISOString();
}
function cleanText(value:unknown,max:number,allowEmpty=false):string|null {
  if(typeof value!=="string" || value.length>max) return null;
  const result=value.trim();
  return !allowEmpty && !result?null:result;
}
function changes(result:unknown):number { return Number((result as {meta?:{changes?:number}})?.meta?.changes??0); }
async function roleFor(db:Db,workspaceId:string,userId:string):Promise<Role|null> {
  const row=await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId,userId).first<{role:Role}>();
  return row?.role??null;
}
async function writeWorkspace(db:Db,userId:string,requested:unknown):Promise<string|null> {
  const id=requested===undefined||requested===null||requested===""?(
    await db.prepare("SELECT id FROM workspaces WHERE owner_user_id=? AND visibility='private'").bind(userId).first<{id:string}>()
  )?.id : (typeof requested==="string"&&requested.length<=64?requested:null);
  if(!id) return null;
  const role=await roleFor(db,id,userId);
  return role==="owner"||role==="editor"?id:null;
}
async function noteInWorkspace(db:Db,noteId:string|null,workspaceId:string):Promise<boolean> {
  if(!noteId) return true;
  const row=await db.prepare("SELECT id FROM notes WHERE id=? AND workspace_id=? AND deleted_at IS NULL").bind(noteId,workspaceId).first<{id:string}>();
  return Boolean(row);
}
function dto(row:EventRow) {
  return {id:row.id,workspaceId:row.workspace_id,title:row.title,description:row.description,startsAt:row.starts_at_utc,endsAt:row.ends_at_utc,timezone:row.timezone,allDay:Boolean(row.all_day),linkedNoteId:row.linked_note_id,createdBy:row.created_by_user_id,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at};
}
async function listEvents(request:Request,env:AuthEnv,userId:string):Promise<Response> {
  const db=env.DB!;
  const url=new URL(request.url);
  const workspaceId=url.searchParams.get("workspaceId");
  const now=Date.now();
  const fromValue=url.searchParams.get("from");
  const toValue=url.searchParams.get("to");
  const from=fromValue?toUtc(fromValue):new Date(now-30*86400000).toISOString();
  const to=toValue?toUtc(toValue):new Date(now+90*86400000).toISOString();
  if(!from||!to||to<=from||new Date(to).getTime()-new Date(from).getTime()>366*86400000) return json({error:"INVALID_DATE_RANGE"},400);
  if(workspaceId&&!(await roleFor(db,workspaceId,userId))) return json({error:"NOT_FOUND"},404);
  const limit=Math.min(200,Math.max(1,Number(url.searchParams.get("limit"))||100));
  const result=workspaceId
    ? await db.prepare("SELECT * FROM calendar_events WHERE workspace_id=? AND deleted_at IS NULL AND starts_at_utc<? AND ends_at_utc>=? ORDER BY starts_at_utc LIMIT ?").bind(workspaceId,to,from,limit).all<EventRow>()
    : await db.prepare("SELECT e.* FROM calendar_events e JOIN workspace_members wm ON wm.workspace_id=e.workspace_id WHERE wm.user_id=? AND e.deleted_at IS NULL AND e.starts_at_utc<? AND e.ends_at_utc>=? ORDER BY e.starts_at_utc LIMIT ?").bind(userId,to,from,limit).all<EventRow>();
  return json({events:result.results.map(dto),from,to});
}
async function createEvent(request:Request,env:AuthEnv,userId:string):Promise<Response> {
  if(!sameOrigin(request)) return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const body=await readJsonBody(request);
  if(!body) return json({error:"INVALID_JSON_BODY"},400);
  const title=cleanText(body.title,200);
  const description=cleanText(body.description??"",5000,true);
  const starts=toUtc(body.startsAt);
  const ends=toUtc(body.endsAt);
  const timezone=validTimezone(body.timezone??"Asia/Kuala_Lumpur");
  const allDay=body.allDay===undefined?false:body.allDay;
  if(!title||description===null||!starts||!ends||ends<=starts||!timezone||typeof allDay!=="boolean") return json({error:"INVALID_EVENT"},400);
  const db=env.DB!;
  const workspaceId=await writeWorkspace(db,userId,body.workspaceId);
  if(!workspaceId) return json({error:"WORKSPACE_FORBIDDEN"},403);
  const linkedNoteId=body.linkedNoteId===undefined||body.linkedNoteId===null||body.linkedNoteId===""?null:(typeof body.linkedNoteId==="string"?cleanText(body.linkedNoteId,64):undefined);
  if(linkedNoteId===undefined||!(await noteInWorkspace(db,linkedNoteId,workspaceId))) return json({error:"INVALID_LINKED_NOTE"},400);
  const id=crypto.randomUUID(); const now=new Date().toISOString();
  try {
    await db.prepare("INSERT INTO calendar_events (id,workspace_id,title,description,starts_at_utc,ends_at_utc,timezone,all_day,linked_note_id,created_by_user_id,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)")
      .bind(id,workspaceId,title,description,starts,ends,timezone,allDay?1:0,linkedNoteId,userId,now,now).run();
  } catch { return json({error:"EVENT_CREATE_FAILED"},400); }
  const row=await db.prepare("SELECT * FROM calendar_events WHERE id=?").bind(id).first<EventRow>();
  return json({event:row?dto(row):null},201);
}
async function eventById(request:Request,env:AuthEnv,userId:string,id:string):Promise<Response> {
  const db=env.DB!;
  const row=await db.prepare("SELECT * FROM calendar_events WHERE id=? AND deleted_at IS NULL").bind(id).first<EventRow>();
  if(!row||!(await roleFor(db,row.workspace_id,userId))) return json({error:"NOT_FOUND"},404);
  if(request.method==="GET") return json({event:dto(row)});
  const role=await roleFor(db,row.workspace_id,userId);
  if(role!=="owner"&&role!=="editor") return json({error:"FORBIDDEN"},403);
  if(!sameOrigin(request)) return json({error:"CSRF_ORIGIN_REJECTED"},403);
  if(request.method==="DELETE") {
    const body=await readJsonBody(request);
    if(!body||Number(body.version)!==row.version) return json({error:"VERSION_CONFLICT",currentVersion:row.version},409);
    const now=new Date().toISOString();
    const result=await db.prepare("UPDATE calendar_events SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL").bind(now,now,id,row.version).run();
    if(changes(result)!==1) return json({error:"VERSION_CONFLICT"},409);
    await db.prepare("UPDATE reminders SET status='cancelled',cancelled_at=?,updated_at=? WHERE event_id=? AND status='pending'").bind(now,now,id).run();
    return json({ok:true});
  }
  if(request.method!=="PATCH") return json({error:"METHOD_NOT_ALLOWED"},405);
  const body=await readJsonBody(request);
  if(!body) return json({error:"INVALID_JSON_BODY"},400);
  const version=Number(body.version);
  const title=body.title===undefined?row.title:cleanText(body.title,200);
  const description=body.description===undefined?row.description:cleanText(body.description,5000,true);
  const starts=body.startsAt===undefined?row.starts_at_utc:toUtc(body.startsAt);
  const ends=body.endsAt===undefined?row.ends_at_utc:toUtc(body.endsAt);
  const timezone=body.timezone===undefined?row.timezone:validTimezone(body.timezone);
  const allDay=body.allDay===undefined?Boolean(row.all_day):body.allDay;
  const linkedNoteId=body.linkedNoteId===undefined?row.linked_note_id:(body.linkedNoteId===null||body.linkedNoteId===""?null:(typeof body.linkedNoteId==="string"?cleanText(body.linkedNoteId,64):undefined));
  if(!Number.isInteger(version)||version!==row.version||!title||description===null||!starts||!ends||ends<=starts||!timezone||typeof allDay!=="boolean"||linkedNoteId===undefined||!(await noteInWorkspace(db,linkedNoteId,row.workspace_id))) return json({error:"INVALID_OR_STALE_EVENT",currentVersion:row.version},409);
  const now=new Date().toISOString();
  const result=await db.prepare("UPDATE calendar_events SET title=?,description=?,starts_at_utc=?,ends_at_utc=?,timezone=?,all_day=?,linked_note_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL")
    .bind(title,description,starts,ends,timezone,allDay?1:0,linkedNoteId,now,id,version).run();
  if(changes(result)!==1) return json({error:"VERSION_CONFLICT"},409);
  const updated=await db.prepare("SELECT * FROM calendar_events WHERE id=?").bind(id).first<EventRow>();
  return json({event:updated?dto(updated):null});
}
export async function handleEventsRequest(request:Request,env:AuthEnv):Promise<Response|null> {
  const url=new URL(request.url);
  if(!url.pathname.startsWith("/api/events")) return null;
  if(!env.DB) return json({error:"DATABASE_NOT_CONFIGURED"},503);
  const user=await getCurrentUser(request,env);
  if(!user) return json({error:"UNAUTHENTICATED"},401);
  if(url.pathname==="/api/events"&&request.method==="GET") return listEvents(request,env,user.id);
  if(url.pathname==="/api/events"&&request.method==="POST") return createEvent(request,env,user.id);
  const match=url.pathname.match(/^\/api\/events\/([^/]+)$/);
  if(match) return eventById(request,env,user.id,decodeURIComponent(match[1]));
  return json({error:"METHOD_NOT_ALLOWED"},405);
}
