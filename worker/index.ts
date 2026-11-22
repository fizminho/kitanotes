import { handleAiRequest } from "./ai";
import { handleEventsRequest } from "./events";
import { handleRemindersRequest } from "./reminders";
import { handleNotificationsRequest } from "./notifications";
import { handlePushRequest } from "./push";
import { deliverDueReminders } from "./reminder-cron";
import { handleInvitationsRequest } from "./invitations";
import { handleNotesRequest } from "./notes";
import { handleAuthRequest } from "./auth";
import { applySecurityHeaders } from "./security-headers";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  APP_ENV?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  APP_BASE_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
    const url=new URL(request.url);
    let response:Response|null=null;
    if(url.pathname==="/api/health") {
      response=json({service:"kitanotes",environment:env.APP_ENV??"development",ok:true});
    } else {
      response=await handleAuthRequest(request,env)
        ?? await handleNotesRequest(request,env,ctx)
        ?? await handleInvitationsRequest(request,env)
        ?? await handleEventsRequest(request,env)
        ?? await handleRemindersRequest(request,env)
        ?? await handleNotificationsRequest(request,env)
        ?? await handlePushRequest(request,env)
        ?? await handleAiRequest(request,env);
      if(!response && url.pathname.startsWith("/api/")) {
        response=json({error:"NOT_IMPLEMENTED",message:"This API route is not available yet."},501);
      }
      if(!response) response=await env.ASSETS.fetch(request);
    }
    return applySecurityHeaders(response,request);
  },
  async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext):Promise<void> {
    if(env.DB) ctx.waitUntil(deliverDueReminders(env.DB,env));
  }
} satisfies ExportedHandler<Env>;
