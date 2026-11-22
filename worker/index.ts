import { handleEventsRequest } from "./events";
import { handleRemindersRequest } from "./reminders";
import { handleNotificationsRequest } from "./notifications";
import { deliverDueReminders } from "./reminder-cron";
import { handleInvitationsRequest } from "./invitations";
import { handleNotesRequest } from "./notes";
import { handleAuthRequest } from "./auth";
interface Env { ASSETS: Fetcher; DB?: D1Database; APP_ENV?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; SESSION_SECRET?: string; APP_BASE_URL?: string; }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
export default { async fetch(request:Request,env:Env):Promise<Response> {
 const url=new URL(request.url);
 if(url.pathname==="/api/health") return json({service:"kitanotes",environment:env.APP_ENV??"development",ok:true});
 const authResponse=await handleAuthRequest(request,env);
 if(authResponse) return authResponse;
 const notesResponse=await handleNotesRequest(request,env);
 if(notesResponse) return notesResponse;
 const invitationResponse=await handleInvitationsRequest(request,env);
 if(invitationResponse) return invitationResponse;
 const eventsResponse=await handleEventsRequest(request,env);
 if(eventsResponse) return eventsResponse;
 const remindersResponse=await handleRemindersRequest(request,env);
 if(remindersResponse) return remindersResponse;
 const notificationsResponse=await handleNotificationsRequest(request,env);
 if(notificationsResponse) return notificationsResponse;
 if(url.pathname.startsWith("/api/")) return json({error:"NOT_IMPLEMENTED",message:"This API route is not available yet."},501);
 const response = await env.ASSETS.fetch(request);
 const headers = new Headers(response.headers);
 headers.set("x-content-type-options", "nosniff");
 headers.set("x-frame-options", "DENY");
 headers.set("referrer-policy", "no-referrer");
 headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
 headers.set("content-security-policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://lh3.googleusercontent.com; connect-src 'self'");
 if (url.protocol === "https:") headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
 return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
 },
 async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  if (env.DB) ctx.waitUntil(deliverDueReminders(env.DB));
 }
} satisfies ExportedHandler<Env>;
