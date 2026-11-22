import { buildPushPayload, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import { getCurrentUser, type AuthEnv } from "./auth.ts";

type PushEnv = AuthEnv & { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
type StoredSubscription = { id:string; endpoint:string; subscription_json:string };
type PushKind = "reminder" | "shared_note" | "shared_note_update" | "event" | "workspace" | "test";
type PushPreferenceRow = {push_enabled:number;reminder_push_enabled:number;shared_note_push_enabled:number;shared_note_update_push_enabled:number;event_push_enabled:number;workspace_push_enabled:number;quiet_hours_start:string|null;quiet_hours_end:string|null;timezone:string};

export function isWithinQuietHours(row:PushPreferenceRow,now=new Date()):boolean {
 if(!row.quiet_hours_start||!row.quiet_hours_end)return false;
 try {
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:row.timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const part=(type:string)=>Number(parts.find(item=>item.type===type)?.value??0);
  const current=part("hour")*60+part("minute");
  const start=Number(row.quiet_hours_start.slice(0,2))*60+Number(row.quiet_hours_start.slice(3));
  const end=Number(row.quiet_hours_end.slice(0,2))*60+Number(row.quiet_hours_end.slice(3));
  return start<end?current>=start&&current<end:current>=start||current<end;
 } catch { return true; }
}

function json(data:unknown,status=200):Response { return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}}); }
function sameOrigin(request:Request):boolean { return request.headers.get("origin")===new URL(request.url).origin; }
type VapidEnv=Pick<PushEnv,"VAPID_PUBLIC_KEY"|"VAPID_PRIVATE_KEY"|"VAPID_SUBJECT">;
function vapid(env:VapidEnv):VapidKeys { return {subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY}; }
function pushConfigured(env:VapidEnv):boolean { return Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT); }
function validEndpoint(value:unknown):value is string {
 if(typeof value!=="string"||value.length>2048)return false;
 try {
  const url=new URL(value); if(url.protocol!=="https:"||url.port!==""||url.username!==""||url.password!=="")return false;
  const host=url.hostname.toLowerCase();
  return host==="fcm.googleapis.com"||host==="updates.push.services.mozilla.com"||host.endsWith(".push.services.mozilla.com")||host==="web.push.apple.com"||host.endsWith(".push.apple.com")||host.endsWith(".notify.windows.com");
 } catch { return false; }
}
async function subscriptionId(endpoint:string):Promise<string> {
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(endpoint));
 return Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,"0")).join("");
}
function validSubscription(value:unknown):value is PushSubscription {
 if(!value||typeof value!=="object")return false;
 const item=value as Record<string,unknown>; const keys=item.keys as Record<string,unknown>|undefined;
 return validEndpoint(item.endpoint)&&!!keys&&typeof keys.p256dh==="string"&&keys.p256dh.length>=80&&keys.p256dh.length<=100&&typeof keys.auth==="string"&&keys.auth.length>=16&&keys.auth.length<=32;
}

export async function sendPushToUser(db:NonNullable<PushEnv["DB"]>,env:VapidEnv,userId:string,data:{title:string;body:string;url?:string;tag?:string},kind:PushKind="test"):Promise<void> {
 if(!pushConfigured(env))return;
 let preferences:PushPreferenceRow;
 try {
  preferences=await db.prepare("SELECT push_enabled,reminder_push_enabled,shared_note_push_enabled,shared_note_update_push_enabled,event_push_enabled,workspace_push_enabled,quiet_hours_start,quiet_hours_end,timezone FROM notification_preferences WHERE user_id=?").bind(userId).first<PushPreferenceRow>()??{push_enabled:1,reminder_push_enabled:1,shared_note_push_enabled:1,shared_note_update_push_enabled:1,event_push_enabled:1,workspace_push_enabled:1,quiet_hours_start:null,quiet_hours_end:null,timezone:"Asia/Kuala_Lumpur"};
 } catch { return; }
 if(preferences.push_enabled!==1)return;
 if(kind==="reminder"&&preferences.reminder_push_enabled!==1)return;
 if(kind==="shared_note"&&preferences.shared_note_push_enabled!==1)return;
 if(kind==="shared_note_update"&&preferences.shared_note_update_push_enabled!==1)return;
 if(kind==="event"&&preferences.event_push_enabled!==1)return;
 if(kind==="workspace"&&preferences.workspace_push_enabled!==1)return;
 if(kind!=="test"&&isWithinQuietHours(preferences))return;
 const rows=await db.prepare("SELECT id,endpoint,subscription_json FROM push_subscriptions WHERE user_id=?").bind(userId).all<StoredSubscription>();
 await Promise.all(rows.results.map(async row=>{
  try {
   const subscription=JSON.parse(row.subscription_json) as PushSubscription;
   const payload=await buildPushPayload({data:{title:data.title.slice(0,80),body:data.body.slice(0,160),url:data.url??"/",tag:data.tag??"kitanotes"},options:{ttl:3600,urgency:"normal"}},subscription,vapid(env));
   const response=await fetch(row.endpoint,{...payload,signal:AbortSignal.timeout(5000)});
   if(response.status===404||response.status===410){await db.prepare("DELETE FROM push_subscriptions WHERE id=?").bind(row.id).run();return;}
   if(response.ok){const now=new Date().toISOString();await db.prepare("UPDATE push_subscriptions SET last_success_at=?,updated_at=? WHERE id=?").bind(now,now,row.id).run();}
  } catch { /* Push is best-effort; the in-app inbox remains authoritative. */ }
 }));
}

export async function handlePushRequest(request:Request,env:PushEnv):Promise<Response|null> {
 const url=new URL(request.url);
 if(!url.pathname.startsWith("/api/push/"))return null;
 if(url.pathname==="/api/push/public-key"&&request.method==="GET")return json({enabled:pushConfigured(env),publicKey:pushConfigured(env)?env.VAPID_PUBLIC_KEY:null});
 if(!env.DB)return json({error:"DATABASE_NOT_CONFIGURED"},503);
 const user=await getCurrentUser(request,env);
 if(!user)return json({error:"UNAUTHENTICATED"},401);
 if(url.pathname==="/api/push/subscriptions"&&request.method==="POST"){
  if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
  if(!pushConfigured(env))return json({error:"PUSH_NOT_CONFIGURED"},503);
  let subscription:unknown;try{subscription=await request.json();}catch{return json({error:"INVALID_JSON_BODY"},400);}
  if(!validSubscription(subscription))return json({error:"INVALID_PUSH_SUBSCRIPTION"},400);
  const id=await subscriptionId(subscription.endpoint);const now=new Date().toISOString();
  const count=await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id=?").bind(user.id).first<{count:number}>();
  const existing=await env.DB.prepare("SELECT id,user_id FROM push_subscriptions WHERE endpoint=?").bind(subscription.endpoint).first<{id:string;user_id:string}>();
  if(existing&&existing.user_id!==user.id)return json({error:"SUBSCRIPTION_ALREADY_REGISTERED"},409);
  if(Number(count?.count??0)>=10&&!existing)return json({error:"SUBSCRIPTION_LIMIT_REACHED"},429);
  await env.DB.prepare("INSERT INTO push_subscriptions (id,user_id,endpoint,subscription_json,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,updated_at=excluded.updated_at")
   .bind(id,user.id,subscription.endpoint,JSON.stringify(subscription),now,now).run();
  return json({ok:true},201);
 }
 if(url.pathname==="/api/push/subscriptions"&&request.method==="DELETE"){
  if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
  let body:unknown;try{body=await request.json();}catch{return json({error:"INVALID_JSON_BODY"},400);}
  const endpoint=body&&typeof body==="object"?(body as Record<string,unknown>).endpoint:null;
  if(!validEndpoint(endpoint))return json({error:"INVALID_PUSH_SUBSCRIPTION"},400);
  const id=await subscriptionId(endpoint);
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE id=? AND user_id=?").bind(id,user.id).run();
  return json({ok:true});
 }
 if(url.pathname==="/api/push/test"&&request.method==="POST"){
  if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
  if(!pushConfigured(env))return json({error:"PUSH_NOT_CONFIGURED"},503);
  await sendPushToUser(env.DB,env,user.id,{title:"KitaNotes",body:"Push notifications are connected on this device.",url:"/",tag:"kitanotes-test"});
  return json({ok:true});
 }
 return json({error:"METHOD_NOT_ALLOWED"},405);
}
