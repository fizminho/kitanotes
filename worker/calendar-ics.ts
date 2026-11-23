import { getCurrentUser, type AuthEnv } from "./auth.ts";
import { readJsonBody } from "./notes.ts";
import { consumeRateLimit, rateLimitResponse } from "./rate-limit.ts";

type Db = NonNullable<AuthEnv["DB"]>;
type Role = "owner" | "editor" | "viewer";
type IcsEvent = { uid:string; title:string; description:string; start:string; end:string; timezone:string; allDay:boolean };
function json(data:unknown,status=200,headers:Record<string,string>={}):Response { return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...headers}}); }
function sameOrigin(request:Request):boolean { return request.headers.get("origin")===new URL(request.url).origin; }
async function readCalendarImportBody(request:Request):Promise<Record<string,unknown>|null>{
 const contentType=request.headers.get("content-type")??"";if(!contentType.toLowerCase().includes("application/json"))return null;
 const declared=Number(request.headers.get("content-length"));if(Number.isFinite(declared)&&declared>2_100_000)return null;
 const reader=request.body?.getReader();if(!reader)return null;const chunks:Uint8Array[]=[];let total=0;
 while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>2_100_000){await reader.cancel();return null;}chunks.push(part.value);}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;}catch{return null;}
}
async function roleFor(db:Db,workspaceId:string,userId:string):Promise<Role|null> { const row=await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId,userId).first<{role:Role}>();return row?.role??null; }
function clean(value:string):string { return value.replace(/\\n/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\").trim(); }
function unfold(text:string):string[] { return text.replace(/\r\n[ \t]/g,"").replace(/\n[ \t]/g,"").split(/\r?\n/); }
function properties(block:string):Map<string,{params:Record<string,string>;value:string}> {
 const map=new Map<string,{params:Record<string,string>;value:string}>();
 for(const line of block.split("\n")){const colon=line.indexOf(":");if(colon<1)continue;const left=line.slice(0,colon).split(";");const name=left.shift()!.toUpperCase();const params:Record<string,string>={};for(const item of left){const at=item.indexOf("=");if(at>0)params[item.slice(0,at).toUpperCase()]=item.slice(at+1).replace(/^"|"$/g,"");}map.set(name,{params,value:line.slice(colon+1)});}
 return map;
}
function localToUtc(value:string,tz:string):string|null {
 const m=value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);if(!m)return null;const target=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]??0));let guess=target;
 try{for(let i=0;i<3;i++){const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));const v=(k:string)=>Number(p.find(x=>x.type===k)?.value??0);const represented=Date.UTC(v("year"),v("month")-1,v("day"),v("hour"),v("minute"),v("second"));const next=guess+target-represented;if(next===guess)break;guess=next;}return new Date(guess).toISOString();}catch{return null;}
}
function parseDate(prop:{params:Record<string,string>;value:string}|undefined,defaultTz:string):{utc:string;allDay:boolean}|null {
 if(!prop)return null;
 if(prop.params.VALUE==="DATE"||/^\d{8}$/.test(prop.value)){const value=prop.value.slice(0,8);if(!/^\d{8}$/.test(value))return null;const start=localToUtc(value+"T000000",defaultTz);return start?{utc:start,allDay:true}:null;}
 const tz=prop.params.TZID||defaultTz;
 if(/Z$/.test(prop.value)){const m=prop.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);if(!m)return null;const d=new Date(m[1]+"-"+m[2]+"-"+m[3]+"T"+m[4]+":"+m[5]+":"+m[6]+"Z");return Number.isNaN(d.getTime())?null:{utc:d.toISOString(),allDay:false};}
 const utc=localToUtc(prop.value,tz);return utc?{utc,allDay:false}:null;
}
export function parseIcs(text:string,defaultTz="Asia/Kuala_Lumpur"):IcsEvent[] {
 const lines=unfold(text);const blocks:string[]=[];let active:string[]|null=null;
 for(const line of lines){if(line==="BEGIN:VEVENT")active=[];else if(line==="END:VEVENT"&&active){blocks.push(active.join("\n"));active=null;}else if(active)active.push(line);}
 const result:IcsEvent[]=[];
 for(const block of blocks){const p=properties(block);const uid=p.get("UID")?.value?.trim();const title=clean(p.get("SUMMARY")?.value??"");const start=parseDate(p.get("DTSTART"),defaultTz);let end=p.get("DTEND")?parseDate(p.get("DTEND"),defaultTz):null;if(!uid||uid.length>512||!title||title.length>200||!start||p.has("RRULE"))continue;if(!end){const d=new Date(start.utc);d.setUTCDate(d.getUTCDate()+1);end={utc:d.toISOString(),allDay:start.allDay};}if(end.utc<=start.utc)continue;result.push({uid,title,description:clean(p.get("DESCRIPTION")?.value??"").slice(0,5000),start:start.utc,end:end.utc,timezone:p.get("DTSTART")?.params.TZID||defaultTz,allDay:start.allDay});}
 return result;
}
function escapeIcs(value:string):string { return value.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;"); }
function foldLine(value:string):string { const chunks:string[]=[];let line="";for(const char of value){if(new TextEncoder().encode(line+char).length>70){chunks.push(line);line=" "+char;}else line+=char;}chunks.push(line);return chunks.join("\r\n"); }
function icsDate(value:string,timezone:string):string { const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));const part=(key:string)=>parts.find(x=>x.type===key)?.value??"0000";return part("year")+part("month")+part("day"); }
function eventIcs(row:{id:string;title:string;description:string;starts_at_utc:string;ends_at_utc:string;all_day:number;timezone:string;source_uid?:string|null}):string {
 const start=row.all_day?"DTSTART;VALUE=DATE:"+icsDate(row.starts_at_utc,row.timezone):"DTSTART:"+new Date(row.starts_at_utc).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
 const end=row.all_day?"DTEND;VALUE=DATE:"+icsDate(row.ends_at_utc,row.timezone):"DTEND:"+new Date(row.ends_at_utc).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
 return ["BEGIN:VEVENT","UID:"+(row.source_uid||row.id+"@kitanotes.binalah.com"),"DTSTAMP:"+new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z"),start,end,"SUMMARY:"+escapeIcs(row.title),"DESCRIPTION:"+escapeIcs(row.description??""),"END:VEVENT"].map(foldLine).join("\r\n");
}
const STATE_SLUGS:Record<string,string>={johor:"jhr",kedah:"kdh",kelantan:"ktn",melaka:"mlk","negeri-sembilan":"nsn",pahang:"phg",perak:"prk",perlis:"pls","pulau-pinang":"png",sabah:"sbh",sarawak:"swk",selangor:"sgr",terengganu:"trg","kuala-lumpur":"kul",labuan:"lbn",putrajaya:"pjy"};
function validState(value:string|null):string|null{return value&&Object.hasOwn(STATE_SLUGS,value)?value:null;}
async function importIcs(request:Request,db:Db,userId:string):Promise<Response>{
 if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);const body=await readCalendarImportBody(request);if(!body||typeof body.ics!=="string"||body.ics.length>2_000_000)return json({error:"INVALID_ICS_FILE"},400);
 const workspaceId=typeof body.workspaceId==="string"?body.workspaceId:"";if(!workspaceId||!(["owner","editor"].includes((await roleFor(db,workspaceId,userId))??"")))return json({error:"WORKSPACE_FORBIDDEN"},403);
 if(!body.ics.includes("BEGIN:VCALENDAR"))return json({error:"INVALID_ICS_FILE"},400);const parsed=parseIcs(body.ics);if(!parsed.length)return json({error:"NO_SUPPORTED_EVENTS"},400);
 const events=parsed.slice(0,500);let imported=0,updated=0,skipped=0;const now=new Date().toISOString();
 for(const item of events){const existing=await db.prepare("SELECT local_event_id FROM calendar_event_imports WHERE workspace_id=? AND source_uid=?").bind(workspaceId,item.uid).first<{local_event_id:string}>();
  if(existing){const changed=await db.prepare("UPDATE calendar_events SET title=?,description=?,starts_at_utc=?,ends_at_utc=?,timezone=?,all_day=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND deleted_at IS NULL").bind(item.title,item.description,item.start,item.end,item.timezone,item.allDay?1:0,now,existing.local_event_id,workspaceId).run();if(Number((changed as {meta?:{changes?:number}}).meta?.changes??0)>0)updated++;else skipped++;}
  else{const id=crypto.randomUUID();await db.prepare("INSERT INTO calendar_events (id,workspace_id,title,description,starts_at_utc,ends_at_utc,timezone,all_day,created_by_user_id,updated_by_user_id,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)").bind(id,workspaceId,item.title,item.description,item.start,item.end,item.timezone,item.allDay?1:0,userId,userId,now,now).run();await db.prepare("INSERT INTO calendar_event_imports (workspace_id,source_uid,local_event_id,created_at,updated_at) VALUES (?,?,?,?,?)").bind(workspaceId,item.uid,id,now,now).run();imported++;}
 }
 return json({ok:true,imported,updated,skipped,ignored:parsed.length-events.length});
}
async function exportIcs(request:Request,db:Db,userId:string):Promise<Response>{
 const workspaceId=new URL(request.url).searchParams.get("workspaceId")??"";if(!workspaceId||!(await roleFor(db,workspaceId,userId)))return json({error:"NOT_FOUND"},404);
 const rows=await db.prepare("SELECT e.id,e.title,e.description,e.starts_at_utc,e.ends_at_utc,e.all_day,e.timezone,ci.source_uid FROM calendar_events e LEFT JOIN calendar_event_imports ci ON ci.local_event_id=e.id WHERE e.workspace_id=? AND e.deleted_at IS NULL ORDER BY e.starts_at_utc LIMIT 1000").bind(workspaceId).all<{id:string;title:string;description:string;starts_at_utc:string;ends_at_utc:string;all_day:number;timezone:string;source_uid:string|null}>();
 const content=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//KitaNotes//Calendar 2.0//EN","CALSCALE:GREGORIAN","X-WR-CALNAME:KitaNotes",...rows.results.map(eventIcs),"END:VCALENDAR"].join("\r\n")+"\r\n";
 return new Response(content,{headers:{"content-type":"text/calendar; charset=utf-8",'content-disposition':'attachment; filename="kitanotes-calendar.ics"',"cache-control":"no-store","x-content-type-options":"nosniff"}});
}
const GROUP_A_STATES=new Set(["kedah","kelantan","terengganu"]);
const SCHOOL_BREAKS:Record<number,Record<"A"|"B",Array<{name:string;start:string;end:string}>>>={
  2026:{
    A:[{name:"Cuti Penggal 1",start:"2026-03-20",end:"2026-03-28"},{name:"Cuti Pertengahan Tahun",start:"2026-05-22",end:"2026-06-06"},{name:"Cuti Penggal 2",start:"2026-08-28",end:"2026-09-05"},{name:"Cuti Akhir Persekolahan",start:"2026-12-04",end:"2026-12-31"}],
    B:[{name:"Cuti Penggal 1",start:"2026-03-21",end:"2026-03-29"},{name:"Cuti Pertengahan Tahun",start:"2026-05-23",end:"2026-06-07"},{name:"Cuti Penggal 2",start:"2026-08-29",end:"2026-09-06"},{name:"Cuti Akhir Persekolahan",start:"2026-12-05",end:"2026-12-31"}]
  },
  2027:{
    A:[{name:"Cuti Penggal 1",start:"2027-03-05",end:"2027-03-13"},{name:"Cuti Pertengahan Tahun",start:"2027-05-21",end:"2027-06-05"},{name:"Cuti Penggal 2",start:"2027-08-27",end:"2027-09-04"},{name:"Cuti Akhir Persekolahan",start:"2027-12-03",end:"2027-12-31"}],
    B:[{name:"Cuti Penggal 1",start:"2027-03-06",end:"2027-03-14"},{name:"Cuti Pertengahan Tahun",start:"2027-05-22",end:"2027-06-06"},{name:"Cuti Penggal 2",start:"2027-08-28",end:"2027-09-05"},{name:"Cuti Akhir Persekolahan",start:"2027-12-04",end:"2027-12-31"}]
  }
};
function addCalendarDays(value:string,days:number):string {
 const date=new Date(value+"T00:00:00Z");date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
export function schoolHolidayEvents(state:string,from:string,to:string){
 const group=GROUP_A_STATES.has(state)?"A":"B";const events=[];
 for(const [year,groups] of Object.entries(SCHOOL_BREAKS)){
  for(const period of groups[group]){
   const endExclusive=addCalendarDays(period.end,1);
   if(period.end<from||period.start>to)continue;
   const startUtc=localToUtc(period.start.replace(/-/g,"")+"T000000","Asia/Kuala_Lumpur");
   const endUtc=localToUtc(endExclusive.replace(/-/g,"")+"T000000","Asia/Kuala_Lumpur");
   if(!startUtc||!endUtc)continue;
   events.push({id:"school-"+year+"-"+group+"-"+period.start,title:period.name+" "+year+" (Kumpulan "+group+")",description:"Cuti sekolah rasmi Kementerian Pendidikan Malaysia · Kumpulan "+group,startsAt:startUtc,endsAt:endUtc,timezone:"Asia/Kuala_Lumpur",allDay:true,holiday:true,holidayType:"school" as const});
  }
 }
 return events;
}
function eventLocalDate(value:string,timezone:string):string {
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));
 const part=(key:string)=>parts.find(x=>x.type===key)?.value??"0000";
 return part("year")+"-"+part("month")+"-"+part("day");
}
type HolidayApiEvent={id:string;title:string;description:string;startsAt:string;endsAt:string;timezone:string;allDay:boolean;holiday:boolean;holidayType:"public"|"school"};
async function cachedHolidayEvents(db:Db|undefined,state:string,from:string,to:string,source:"public"|"school"):Promise<{events:HolidayApiEvent[];years:Set<number>}> {
 const events:HolidayApiEvent[]=[];const years=new Set<number>();
 if(!db)return{events,years};
 const first=Number(from.slice(0,4)),last=Number(to.slice(0,4));
 for(let year=first;year<=last;year++){
  const row=await db.prepare("SELECT events_json FROM calendar_holiday_cache WHERE state=? AND holiday_year=? AND source=?").bind(state,year,source).first<{events_json:string}>();
  if(!row)continue;
  try{const parsed=JSON.parse(row.events_json);if(Array.isArray(parsed)){events.push(...parsed as HolidayApiEvent[]);years.add(year);}}catch{/* retain fallback when cache is malformed */}
 }
 return{events,years};
}
async function savePublicHolidayCache(db:Db|undefined,state:string,events:HolidayApiEvent[],syncedAt=new Date().toISOString()):Promise<Set<number>> {
 const grouped=new Map<number,HolidayApiEvent[]>();
 for(const event of events){
  const year=Number(eventLocalDate(event.startsAt,event.timezone).slice(0,4));
  const list=grouped.get(year)??[];list.push(event);grouped.set(year,list);
 }
 if(db){
  for(const [year,items] of grouped){
   await db.prepare("INSERT INTO calendar_holiday_cache (state,holiday_year,source,events_json,synced_at) VALUES (?,?,?,?,?) ON CONFLICT(state,holiday_year,source) DO UPDATE SET events_json=excluded.events_json,synced_at=excluded.synced_at").bind(state,year,"public",JSON.stringify(items),syncedAt).run();
  }
 }
 return new Set(grouped.keys());
}
async function readLimitedFeed(response:Response,maxBytes=1_048_576):Promise<string>{
 const declared=Number(response.headers.get("content-length"));
 if(Number.isFinite(declared)&&declared>maxBytes)throw new Error("HolidayWise feed exceeds the size limit");
 if(!response.body)throw new Error("HolidayWise feed is empty");
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error("HolidayWise feed exceeds the size limit");}chunks.push(part.value);}}
 catch(error){try{await reader.cancel();}catch{}throw error;}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder().decode(bytes);
}
async function holidays(request:Request,db?:Db):Promise<Response>{
 const url=new URL(request.url);const state=validState(url.searchParams.get("state"));if(!state)return json({error:"INVALID_STATE"},400);
 if(db){
  const clientIp=request.headers.get("cf-connecting-ip")??"unknown";
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(clientIp));
  const ipKey=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
  const ipRate=await consumeRateLimit(db,"calendar:holidays:ip:"+ipKey,60,5*60*1000);
  if(!ipRate.allowed)return rateLimitResponse(ipRate.retryAfterSeconds);
 }
 const from=url.searchParams.get("from")??new Date().getFullYear()+"-01-01";const to=url.searchParams.get("to")??(new Date().getFullYear()+1)+"-12-31";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(to)||from>to||Number(to.slice(0,4))-Number(from.slice(0,4))>3)return json({error:"INVALID_DATE_RANGE"},400);
 const publicCache=await cachedHolidayEvents(db,state,from,to,"public");
 const schoolCache=await cachedHolidayEvents(db,state,from,to,"school");
 const requestedYears=Array.from({length:Number(to.slice(0,4))-Number(from.slice(0,4))+1},(_,i)=>Number(from.slice(0,4))+i);
 let publicEvents:HolidayApiEvent[]=publicCache.events;
 let holidayWiseAvailable=publicCache.years.size===requestedYears.length;
 let holidayWiseError:string|null=null;
 if(!holidayWiseAvailable){
  try{
   if(db){const refreshRate=await consumeRateLimit(db,"calendar:holidays:refresh:"+state,1,60*1000);if(!refreshRate.allowed)throw new Error("HolidayWise refresh temporarily rate limited");}
   const response=await fetch("https://holidaywise.wee.my/my/"+STATE_SLUGS[state]+"/nat-state.ics",{headers:{accept:"text/calendar"},signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error("HolidayWise returned HTTP "+response.status);
   const parsed=parseIcs(await readLimitedFeed(response));
   if(!parsed.length)throw new Error("HolidayWise feed returned no readable calendar events");
   const allEvents=parsed.map(e=>({id:"holiday-"+e.uid,title:e.title,description:e.description,startsAt:e.start,endsAt:e.end,timezone:e.timezone,allDay:e.allDay,holiday:true,holidayType:"public" as const}));
   const availableYears=await savePublicHolidayCache(db,state,allEvents);
   const fresh=allEvents.filter(e=>{const day=eventLocalDate(e.startsAt,e.timezone);return day>=from&&day<=to;});
   if(fresh.length>0||publicCache.events.length===0)publicEvents=fresh;
   holidayWiseAvailable=requestedYears.every(year=>availableYears.has(year));
  }catch(error){
   holidayWiseError=error instanceof Error?error.message:"HolidayWise feed unavailable";
   publicEvents=publicCache.events;
   holidayWiseAvailable=publicCache.events.length>0;
  }
 }
 const schoolEvents:HolidayApiEvent[]=[];
 for(const year of requestedYears){
  if(schoolCache.years.has(year)){schoolEvents.push(...schoolCache.events.filter(event=>eventLocalDate(event.startsAt,event.timezone).startsWith(String(year))));}
  else schoolEvents.push(...schoolHolidayEvents(state,from,to).filter(event=>event.title.includes(" "+year+" ")));
 }
 const events=[...publicEvents,...schoolEvents].filter(event=>{const day=eventLocalDate(event.startsAt,event.timezone);return day>=from&&day<=to;}).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
 return json({state,events,source:"HolidayWise + KPM",sources:{holidayWise:holidayWiseAvailable,kpm:true,publicHolidayCount:publicEvents.length,schoolHolidayCount:schoolEvents.length,holidayWiseError},updatedAt:new Date().toISOString()},200,{"cache-control":"public, max-age=900, s-maxage=3600"});
}
export async function syncCalendarHolidayData(db:Db,now=new Date()):Promise<{states:number;publicEvents:number;schoolEvents:number;failedStates:string[]}> {
 const syncedAt=now.toISOString();const currentYear=now.getUTCFullYear();let publicEvents=0,schoolEvents=0;const failedStates:string[]=[];
 const stateEntries=Object.entries(STATE_SLUGS);
 await Promise.all(stateEntries.map(async([state,slug])=>{
  try{
   const response=await fetch("https://holidaywise.wee.my/my/"+slug+"/nat-state.ics",{headers:{accept:"text/calendar"},signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw new Error("HTTP "+response.status);
   const parsed=parseIcs(await response.text());if(!parsed.length)throw new Error("Empty or unreadable ICS feed");
   const grouped=new Map<number,HolidayApiEvent[]>();
   for(const item of parsed){
    const year=Number(eventLocalDate(item.start,item.timezone).slice(0,4));
    if(year<currentYear||year>currentYear+2)continue;
    const list=grouped.get(year)??[];
    list.push({id:"holiday-"+item.uid,title:item.title,description:item.description,startsAt:item.start,endsAt:item.end,timezone:item.timezone,allDay:item.allDay,holiday:true,holidayType:"public"});
    grouped.set(year,list);
   }
   for(const [year,items] of grouped){
    await db.prepare("INSERT INTO calendar_holiday_cache (state,holiday_year,source,events_json,synced_at) VALUES (?,?,?,?,?) ON CONFLICT(state,holiday_year,source) DO UPDATE SET events_json=excluded.events_json,synced_at=excluded.synced_at").bind(state,year,"public",JSON.stringify(items),syncedAt).run();
    publicEvents+=items.length;
   }
  }catch{failedStates.push(state);}
 }));
 for(const state of Object.keys(STATE_SLUGS)){
  for(const year of Object.keys(SCHOOL_BREAKS).map(Number)){
   const items=schoolHolidayEvents(state,year+"-01-01",year+"-12-31") as HolidayApiEvent[];
   if(!items.length)continue;
   await db.prepare("INSERT INTO calendar_holiday_cache (state,holiday_year,source,events_json,synced_at) VALUES (?,?,?,?,?) ON CONFLICT(state,holiday_year,source) DO UPDATE SET events_json=excluded.events_json,synced_at=excluded.synced_at").bind(state,year,"school",JSON.stringify(items),syncedAt).run();
   schoolEvents+=items.length;
  }
 }
 return{states:stateEntries.length,publicEvents,schoolEvents,failedStates};
}

export async function handleCalendarIcsRequest(request:Request,env:AuthEnv):Promise<Response|null>{
 const url=new URL(request.url);
 if(url.pathname==="/api/calendar/holidays"&&request.method==="GET")return holidays(request,env.DB);
 if(!url.pathname.startsWith("/api/calendar/ics/")&&url.pathname!=="/api/calendar/preferences")return null;
 if(!env.DB)return json({error:"DATABASE_NOT_CONFIGURED"},503);
 const user=await getCurrentUser(request,env);if(!user)return json({error:"UNAUTHENTICATED"},401);
 if(url.pathname==="/api/calendar/preferences"&&request.method==="GET"){
  const row=await env.DB.prepare("SELECT holiday_state FROM user_calendar_preferences WHERE user_id=?").bind(user.id).first<{holiday_state:string}>();
  return json({holidayState:row?.holiday_state??"selangor"});
 }
 if(url.pathname==="/api/calendar/preferences"&&request.method==="PUT"){
  if(!sameOrigin(request))return json({error:"CSRF_ORIGIN_REJECTED"},403);
  const body=await readJsonBody(request);const state=validState(typeof body?.holidayState==="string"?body.holidayState:null);
  if(!state)return json({error:"INVALID_STATE"},400);
  await env.DB.prepare("INSERT INTO user_calendar_preferences (user_id,holiday_state,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET holiday_state=excluded.holiday_state,updated_at=excluded.updated_at").bind(user.id,state,new Date().toISOString()).run();
  return json({holidayState:state});
 }
 if(url.pathname==="/api/calendar/ics/import"&&request.method==="POST")return importIcs(request,env.DB,user.id);
 if(url.pathname==="/api/calendar/ics/export"&&request.method==="GET")return exportIcs(request,env.DB,user.id);
 return json({error:"METHOD_NOT_ALLOWED"},405);
}
