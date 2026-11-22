interface Env { ASSETS: Fetcher; APP_ENV?: string; }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
export default { async fetch(request:Request,env:Env):Promise<Response> {
 const url=new URL(request.url);
 if(url.pathname==="/api/health") return json({service:"kitanotes",environment:env.APP_ENV??"development",ok:true});
 if(url.pathname.startsWith("/api/")) return json({error:"NOT_IMPLEMENTED",message:"This API route is not available yet."},501);
 return env.ASSETS.fetch(request);
}} satisfies ExportedHandler<Env>;
