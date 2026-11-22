import { handleAiRequest } from "./ai";
import { handleOcrRequest } from "./ocr";
import { handleEventsRequest } from "./events";
import { handleRemindersRequest } from "./reminders";
import { handleNotificationsRequest } from "./notifications";
import { handlePushRequest } from "./push";
import { deliverDueReminders } from "./reminder-cron";
import { handleInvitationsRequest } from "./invitations";
import { handleNotesRequest } from "./notes";
import { handleAuthRequest } from "./auth";
import { handleCalendarIcsRequest, syncCalendarHolidayData } from "./calendar-ics";
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
    } else if(url.pathname.startsWith("/api/google-calendar/")||url.pathname.startsWith("/auth/google/calendar/")) {
      response=json({error:"CALENDAR_OAUTH_REMOVED",message:"Use .ics calendar import and export instead."},410);
    } else {
      response=await handleCalendarIcsRequest(request,env)
        ?? await handleAuthRequest(request,env)
        ?? await handleNotesRequest(request,env,ctx)
        ?? await handleInvitationsRequest(request,env)
        ?? await handleEventsRequest(request,env)
        ?? await handleRemindersRequest(request,env)
        ?? await handleNotificationsRequest(request,env)
        ?? await handlePushRequest(request,env)
        ?? await handleOcrRequest(request,env)
        ?? await handleAiRequest(request,env);
      if(!response && url.pathname.startsWith("/api/")) {
        response=json({error:"NOT_IMPLEMENTED",message:"This API route is not available yet."},501);
      }
      if(!response) response=await env.ASSETS.fetch(request);
    }
    return applySecurityHeaders(response,request);
  },
  async scheduled(controller:ScheduledController,env:Env,ctx:ExecutionContext):Promise<void> {
    if(!env.DB)return;
    if(controller.cron==="*/5 * * * *")ctx.waitUntil(deliverDueReminders(env.DB,env));
    if(controller.cron==="0 2 1 8-12 *"||controller.cron==="0 2 31 12 *")ctx.waitUntil(syncCalendarHolidayData(env.DB));
  }
} satisfies ExportedHandler<Env>;
