import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleAiRequest, getFreeGeminiModelCandidates, validateAiDraft } from "./ai.ts";
import { handleNotesRequest } from "./notes.ts";

class D1TestDatabase {
  constructor(){
    this.sqlite=new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for(const file of ["migrations/0001_initial.sql","migrations/0002_sessions.sql","migrations/0003_invitation_accept_trigger.sql","migrations/0004_calendar_reminders_notifications.sql","migrations/0005_shared_note_notifications.sql","migrations/0006_ai_consent_and_usage.sql"])
      this.sqlite.exec(readFileSync(new URL("../"+file,import.meta.url),"utf8"));
  }
  prepare(sql){
    const database=this.sqlite;
    return{bind(...values){return{
      first:async()=>database.prepare(sql).get(...values)??null,
      all:async()=>({results:database.prepare(sql).all(...values)}),
      run:async()=>{const result=database.prepare(sql).run(...values);return{meta:{changes:Number(result.changes)}};}
    };}};
  }
  close(){this.sqlite.close();}
}
function seed(){
  const db=new D1TestDatabase();const now=new Date().toISOString();
  db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES ('u1','sub1','one@example.com','one@example.com',1,?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w1','Personal','u1','personal',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',?)").run(now);
  db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ('s1','u1',?,'2099-01-01T00:00:00.000Z',?)").run(createHash("sha256").update("ai-session").digest("base64url"),now);
  return{db,env:{DB:db,GEMINI_API_KEY:"test-key",GEMINI_MODEL:"gemini-3.1-flash-lite",GEMINI_MODEL_FALLBACKS:"gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.5-flash"}};
}
function request(path,method="GET",body){
  const headers={cookie:"__Host-kitanotes_session=ai-session"};
  const init={method,headers};
  if(method!=="GET")headers.origin="https://kitanotes.test";
  if(body!==undefined){headers["content-type"]="application/json";init.body=JSON.stringify(body);}
  return new Request("https://kitanotes.test"+path,init);
}
const validDraft={
  summary:"Meeting and follow-up",
  note:{title:"Project meeting",content:"Discuss the launch and follow up with the team."},
  suggestedCategories:[{name:"Work",reason:"Project planning"}],
  events:[{title:"Project review",description:"Review milestones",startLocal:"2026-11-23T10:00",endLocal:"2026-11-23T11:00",reminderLocal:"2026-11-23T09:30"}],
  reminders:[{title:"Send the agenda",dueLocal:"2026-11-23T16:00"}],
  tasks:[{title:"Prepare slides",dueLocal:"2026-11-23T12:00"}],
  clarifyingQuestions:[]
};
const okResponse=()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(validDraft)}]}}]}),{status:200});

test("free model allowlist excludes paid or unknown models",()=>{
  assert.deepEqual(getFreeGeminiModelCandidates("gemini-1.5-pro","gemini-2.5-flash,gemini-pro,gemini-3.5-flash"),["gemini-3.1-flash-lite","gemini-3.5-flash"]);
  assert.deepEqual(getFreeGeminiModelCandidates("gemini-3.6-flash",""),["gemini-3.6-flash","gemini-3.1-flash-lite","gemini-3.5-flash-lite","gemini-3.5-flash"]);
});

test("draft validator rejects invalid local dates and preserves timezone",()=>{
  const valid=validateAiDraft(validDraft,"Asia/Kuala_Lumpur");
  assert.equal(valid.timezone,"Asia/Kuala_Lumpur");
  assert.equal(valid.events[0].startLocal,"2026-11-23T10:00");
  const invalid=structuredClone(validDraft);
  invalid.events[0].startLocal="2026-02-31T10:00";
  assert.equal(validateAiDraft(invalid,"Asia/Kuala_Lumpur"),null);
});

test("AI requires explicit privacy consent before sending any text",async()=>{
  const{db,env}=seed();
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return okResponse();};
  try{
    const response=await handleAiRequest(request("/api/ai/organize","POST",{text:"A note with a private detail",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(response.status,428);
    assert.equal(calls,0);
    const status=await handleAiRequest(request("/api/ai/status"),env);
    assert.equal((await status.json()).consented,false);
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test("consented organiser falls back from a missing model to the next free model",async()=>{
  const{db,env}=seed();
  const originalFetch=globalThis.fetch;const models=[];
  globalThis.fetch=async(url,init)=>{
    models.push(String(url));
    assert.equal(new Headers(init.headers).get("x-goog-api-key"),"test-key");
    if(String(url).includes("gemini-3.1-flash-lite"))return new Response(JSON.stringify({error:{message:"model not found"}}),{status:404});
    return okResponse();
  };
  try{
    const consent=await handleAiRequest(request("/api/ai/consent","POST",{accepted:true}),env);
    assert.equal(consent.status,200);
    const response=await handleAiRequest(request("/api/ai/organize","POST",{text:"Tomorrow at 10am, review the project plan and remind me at 9:30.",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.model,"gemini-3.5-flash-lite");
    assert.equal(payload.requiresUserConfirmation,true);
    assert.equal(payload.draft.events[0].startLocal,"2026-11-23T10:00");
    assert.equal(models.length,2);
    assert.ok(models.every(url=>/gemini-(3\.1-flash-lite|3\.5-flash-lite|3\.6-flash|3\.5-flash):generateContent/.test(url)));
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM ai_request_usage").get().count,1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notes").get().count,0);
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test("quota exhaustion stays free-only and never escalates to a paid model",async()=>{
  const{db,env}=seed();const originalFetch=globalThis.fetch;const models=[];
  globalThis.fetch=async url=>{models.push(String(url));return new Response(JSON.stringify({error:{message:"RESOURCE_EXHAUSTED quota exceeded"}}),{status:429,headers:{"retry-after":"30"}});};
  try{
    await handleAiRequest(request("/api/ai/consent","POST",{accepted:true}),env);
    const response=await handleAiRequest(request("/api/ai/organize","POST",{text:"Organise these notes",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(response.status,429);
    const payload=await response.json();
    assert.equal(payload.error,"AI_FREE_QUOTA_EXHAUSTED");
    assert.equal(payload.paidFallback,false);
    assert.equal(payload.retryAfterMs,30000);
    assert.equal(models.length,4);
    assert.ok(models.every(url=>!url.includes("pro")&&!url.includes("paid")));
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test("invalid API key errors stop immediately instead of trying fallback models",async()=>{
  const{db,env}=seed();const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{message:"API key not valid"}}),{status:401});};
  try{
    await handleAiRequest(request("/api/ai/consent","POST",{accepted:true}),env);
    const response=await handleAiRequest(request("/api/ai/organize","POST",{text:"Organise these notes",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(response.status,502);
    assert.equal((await response.json()).error,"GEMINI_AUTH_OR_PERMISSION_FAILED");
    assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test("per-user daily cap blocks requests before Gemini is called and consent can be revoked",async()=>{
  const{db,env}=seed();const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return okResponse();};
  try{
    await handleAiRequest(request("/api/ai/consent","POST",{accepted:true}),env);
    const day=new Date().toISOString().slice(0,10);
    db.sqlite.prepare("INSERT INTO ai_request_usage (user_id,usage_date,request_count) VALUES ('u1',?,10)").run(day);
    const limited=await handleAiRequest(request("/api/ai/organize","POST",{text:"This should not be sent",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(limited.status,429);
    assert.equal(calls,0);
    const revoked=await handleAiRequest(request("/api/ai/consent","DELETE"),env);
    assert.equal(revoked.status,200);
    const status=await handleAiRequest(request("/api/ai/status"),env);
    assert.equal((await status.json()).consented,false);
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test("transient 503 falls through to the next allowlisted free model",async()=>{
  const{db,env}=seed();const originalFetch=globalThis.fetch;const models=[];
  globalThis.fetch=async url=>{models.push(String(url));if(models.length===1)return new Response(JSON.stringify({error:{message:"temporarily unavailable"}}),{status:503});return okResponse();};
  try{
    await handleAiRequest(request("/api/ai/consent","POST",{accepted:true}),env);
    const response=await handleAiRequest(request("/api/ai/organize","POST",{text:"Meeting notes",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(response.status,200);
    assert.equal(models.length,2);
    assert.ok(models.every(url=>url.includes("gemini-")));
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test("malformed model JSON falls back and total provider outage does not block manual notes",async()=>{
  const{db,env}=seed();const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"not json"}]}}]}),{status:200});throw new Error("provider unavailable");};
  try{
    await handleAiRequest(request("/api/ai/consent","POST",{accepted:true}),env);
    const aiResponse=await handleAiRequest(request("/api/ai/organize","POST",{text:"Meeting notes",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(aiResponse.status,503);
    assert.equal((await aiResponse.json()).paidFallback,false);
    const manualNote=await handleNotesRequest(request("/api/notes","POST",{title:"Manual note still works",content:"AI is unavailable",workspaceId:"w1"}),env);
    assert.equal(manualNote.status,201);
    assert.equal(calls,4);
  }finally{globalThis.fetch=originalFetch;db.close();}
});
