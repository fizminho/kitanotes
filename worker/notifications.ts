import { getCurrentUser, type AuthEnv } from "./auth.ts";

type NotificationRow={id:string;workspace_id:string|null;notification_type:string;title:string;body:string;resource_type:string|null;resource_id:string|null;created_at:string;read_at:string|null};
type PreferenceRow={push_enabled:number;reminder_push_enabled:number;shared_note_push_enabled:number;quiet_hours_start:string|null;quiet_hours_end:string|null;timezone:string};
type Preferences={pushEnabled:boolean;reminderPushEnabled:boolean;sharedNotePushEnabled:boolean;quietHoursStart:string|null;quietHoursEnd:string|null;timezone:string};
function json(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
function sameOrigin(request:Request):boolean{return request.headers.get("origin")===new URL(request.url).origin;}
function dto(row:NotificationRow){return{id:row.id,workspaceId:row.workspace_id,type:row.notification_type,title:row.title,body:row.body,resourceType:row.resource_type,resourceId:row.resource_id,createdAt:row.created_at,readAt:row.read_at};}
function preferenceDto(row:PreferenceRow):Preferences{return{pushEnabled:row.push_enabled===1,reminderPushEnabled:row.reminder_push_enabled===1,sharedNotePushEnabled:row.shared_note_push_enabled===1,quietHoursStart:row.quiet_hours_start,quietHoursEnd:row.quiet_hours_end,timezone:row.timezone};}
const DEFAULTS:Preferences={pushEnabled:true,reminderPushEnabled:true,sharedNotePushEnabled:true,quietHoursStart:null,quietHoursEnd:null,timezone:"Asia/Kuala_Lumpur"};
async function readPreferences(db:NonNullable<AuthEnv["DB"]>,userId:string):Promise<Preferences>{
 const row=await db.prepare("SELECT push_enabled,reminder_push_enabled,shared_note_push_enabled,quiet_hours_start,quiet_hours_end,timezone FROM notification_preferences WHERE user_id=?").bind(userId).first<PreferenceRow>();
 return row?preferenceDto(row):DEFAULTS;
}
function validTime(value:unknown):value is string|null{return value===null||(typeof value==="string"&&/^([01]\\d|2[0-3]):[0-5]\\d$/.test(value));}
function validTimezone(value:unknown):value is string{
 if(typeof value!=="string"||value.length<1||value.length>64)return false;
 try{new Intl.DateTimeFormat("en-US",{timeZone:value}).format(new Date());return true;}catch{return false;}
}
function parsePreferences(value:unknown):Preferences|null{
 if(!value||typeof value!=="object")return null;
 const item=value as Record<string,unknown>;
 if(typeof item.pushEnabled!=="boolean"||typeof item.reminderPushEnabled!=="boolean"||typeof item.sharedNotePushEnabled!=="boolean"||
    !validTime(item.quietHoursStart)||!validTime(item.quietHoursEnd)||!validTimezone(item.timezone))return null;
 if((item.quietHoursStart===null)!==(item.quietHoursEnd===null)||item.quietHoursStart===item.quietHoursEnd&&item.quietHoursStart!==null)return null;
 return{pushEnabled:item.pushEnabled,reminderPushEnabled:item.reminderPushEnabled,sharedNotePushEnabled:item.sharedNotePushEnabled,quietHoursStart:item.quietHoursStart,quietHoursEnd:item.quietHoursEnd,timezone:item.timezone};
}
export async function handleNotificationsRequest(request:Request,env:AuthEnv):Promise<Response|null>{
 const url=new URL(request.url);
 if(!url.pathname.startsWith("/api/notifications"))return null;
 if(!env.DB)return json({error:"DATABASE_NOT_CONFIGURED"},503);
 const user=await getCurrentUser(request,env);
 if(!user)return json({error:"UNAUTHENTICATED"},401);
 const db=env.DB;
 if(url.pathname==="/api/notifications/preferences"&&request.method==="GET"){
  return json({preferences:await readPreferences(db,user.id)});
 }
 if(url.pathname==="/api/notifications/preferences"&&request.method==="PUT"){
  if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
  let body:unknown;try{body=await request.json();}catch{return json({error:"INVALID_JSON_BODY"},400);}
  const preferences=parsePreferences(body);if(!preferences)return json({error:"INVALID_NOTIFICATION_PREFERENCES"},400);
  const now=new Date().toISOString();
  await db.prepare("INSERT INTO notification_preferences (user_id,push_enabled,reminder_push_enabled,shared_note_push_enabled,quiet_hours_start,quiet_hours_end,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET push_enabled=excluded.push_enabled,reminder_push_enabled=excluded.reminder_push_enabled,shared_note_push_enabled=excluded.shared_note_push_enabled,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,timezone=excluded.timezone,updated_at=excluded.updated_at")
   .bind(user.id,preferences.pushEnabled?1:0,preferences.reminderPushEnabled?1:0,preferences.sharedNotePushEnabled?1:0,preferences.quietHoursStart,preferences.quietHoursEnd,preferences.timezone,now,now).run();
  return json({ok:true,preferences});
 }
 if(url.pathname==="/api/notifications"&&request.method==="GET"){
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||50));
  const unreadOnly=url.searchParams.get("unreadOnly")==="1";
  const result=unreadOnly
   ? await db.prepare("SELECT * FROM notifications WHERE user_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?").bind(user.id,limit).all<NotificationRow>()
   : await db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ?").bind(user.id,limit).all<NotificationRow>();
  const unread=await db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read_at IS NULL").bind(user.id).first<{count:number}>();
  return json({notifications:result.results.map(dto),unreadCount:Number(unread?.count??0)});
 }
 if(url.pathname==="/api/notifications/read-all"&&request.method==="POST"){
  if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const now=new Date().toISOString();
  await db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").bind(now,user.id).run();
  return json({ok:true});
 }
 const match=url.pathname.match(/^\\/api\\/notifications\\/([^/]+)\\/read$/);
 if(match&&request.method==="POST"){
  if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const id=decodeURIComponent(match[1]);const now=new Date().toISOString();
  const result=await db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL").bind(now,id,user.id).run();
  const changes=Number((result as {meta?:{changes?:number}}).meta?.changes??0);
  if(changes===0){
   const exists=await db.prepare("SELECT id FROM notifications WHERE id=? AND user_id=?").bind(id,user.id).first<{id:string}>();
   if(!exists)return json({error:"NOT_FOUND"},404);
  }
  return json({ok:true});
 }
 return json({error:"METHOD_NOT_ALLOWED"},405);
}
