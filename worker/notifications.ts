import { getCurrentUser, type AuthEnv } from "./auth.ts";

type Db=NonNullable<AuthEnv["DB"]>;
type NotificationRow={id:string;workspace_id:string|null;notification_type:string;title:string;body:string;resource_type:string|null;resource_id:string|null;created_at:string;read_at:string|null};
function json(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
function sameOrigin(request:Request):boolean{return request.headers.get("origin")===new URL(request.url).origin;}
function dto(row:NotificationRow){return{id:row.id,workspaceId:row.workspace_id,type:row.notification_type,title:row.title,body:row.body,resourceType:row.resource_type,resourceId:row.resource_id,createdAt:row.created_at,readAt:row.read_at};}
export async function handleNotificationsRequest(request:Request,env:AuthEnv):Promise<Response|null>{
 const url=new URL(request.url);
 if(!url.pathname.startsWith("/api/notifications"))return null;
 if(!env.DB)return json({error:"DATABASE_NOT_CONFIGURED"},503);
 const user=await getCurrentUser(request,env);
 if(!user)return json({error:"UNAUTHENTICATED"},401);
 const db=env.DB;
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
 const match=url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
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
