import { handleAuthRequest } from "./auth";
interface Env { ASSETS: Fetcher; DB?: D1Database; APP_ENV?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; SESSION_SECRET?: string; APP_BASE_URL?: string; }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
export default { async fetch(request:Request,env:Env):Promise<Response> {
 const url=new URL(request.url);
 if(url.pathname==="/api/health") return json({service:"kitanotes",environment:env.APP_ENV??"development",ok:true});
 const authResponse=await handleAuthRequest(request,env);
 if(authResponse) return authResponse;
 if(url.pathname.startsWith("/api/")) return json({error:"NOT_IMPLEMENTED",message:"This API route is not available yet."},501);
 return env.ASSETS.fetch(request);
}} satisfies ExportedHandler<Env>;
