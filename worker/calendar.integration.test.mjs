import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleEventsRequest } from "./events.ts";
import { handleCalendarIcsRequest, syncCalendarHolidayData } from "./calendar-ics.ts";
import { handleRemindersRequest } from "./reminders.ts";
import { handleNotificationsRequest } from "./notifications.ts";
import { deliverDueReminders } from "./reminder-cron.ts";

class D1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of ["migrations/0001_initial.sql","migrations/0002_sessions.sql","migrations/0003_invitation_accept_trigger.sql","migrations/0004_calendar_reminders_notifications.sql","migrations/0005_shared_note_notifications.sql","migrations/0006_ai_consent_and_usage.sql", "migrations/0007_request_rate_limits.sql", "migrations/0008_push_subscriptions.sql","migrations/0009_notification_preferences.sql","migrations/0011_workspace_visibility.sql","migrations/0012_unified_workspace_type.sql","migrations/0013_content_audit_and_open_invites.sql", "migrations/0014_google_calendar_import.sql","migrations/0015_notification_activity_preferences.sql","migrations/0016_calendar_2_0.sql","migrations/0017_calendar_holiday_cache.sql"]) {
      this.sqlite.exec(readFileSync(new URL("../"+file,import.meta.url),"utf8"));
    }
  }
  prepare(sql) {
    const database=this.sqlite;
    return { bind(...values) {
      return {
        first:async()=>database.prepare(sql).get(...values)??null,
        all:async()=>({results:database.prepare(sql).all(...values)}),
        run:async()=>{const result=database.prepare(sql).run(...values);return{meta:{changes:Number(result.changes)}};}
      };
    }};
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results=[];
      for(const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch(error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close(){this.sqlite.close();}
}
function seed(){
  const db=new D1TestDatabase();const now=new Date().toISOString();
  for(const [id,sub,email] of [["u1","sub1","one@example.com"],["u2","sub2","two@example.com"],["u3","sub3","three@example.com"]])
    db.sqlite.prepare("INSERT INTO users (id,google_sub,email,email_normalized,email_verified,created_at,updated_at) VALUES (?,?,?,?,1,?,?)").run(id,sub,email,email,now,now);
  for(const [id,owner] of [["w1","u1"],["w2","u2"],["w3","u3"]])
    db.sqlite.prepare("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,visibility,created_at,updated_at) VALUES (?,?,?,'shared','private',?,?)").run(id,id,owner,now,now);
  for(const [workspace,user,role] of [["w1","u1","owner"],["w1","u2","viewer"],["w2","u2","owner"],["w3","u3","owner"]])
    db.sqlite.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)").run(workspace,user,role,now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n1','w1','Note one','Body','u1',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO notes (id,workspace_id,title,content,created_by_user_id,created_at,updated_at) VALUES ('n2','w2','Note two','Private','u2',?,?)").run(now,now);
  const tokens={u1:"calendar-session-1",u2:"calendar-session-2",u3:"calendar-session-3"};
  for(const [user,token] of Object.entries(tokens))
    db.sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)").run("s-"+user,user,createHash("sha256").update(token).digest("base64url"),"2099-01-01T00:00:00.000Z",now);
  return{db,env:{DB:db},tokens};
}
function request(path,token,method="GET",body){
  const headers={cookie:"__Host-kitanotes_session="+token};
  const init={method,headers};
  if(method!=="GET")headers.origin="https://kitanotes.test";
  if(body!==undefined){headers["content-type"]="application/json";init.body=JSON.stringify(body);}
  return new Request("https://kitanotes.test"+path,init);
}

test("calendar events store UTC instants, retain timezone and enforce workspace roles",async()=>{
  const{db,env,tokens}=seed();
  try{
    const created=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{title:"School meeting",description:"Meet teacher",startsAt:"2026-11-23T09:00:00+08:00",endsAt:"2026-11-23T10:00:00+08:00",timezone:"Asia/Kuala_Lumpur",linkedNoteId:"n1"}),env);
    assert.equal(created.status,201);
    const event=(await created.json()).event;
    assert.equal(event.startsAt,"2026-11-23T01:00:00.000Z");
    assert.equal(event.timezone,"Asia/Kuala_Lumpur");
    assert.equal(event.createdBy,"u1");
    assert.equal(event.updatedBy,"u1");
    assert.ok(event.createdAt&&event.updatedAt);
    const edited=await handleEventsRequest(request("/api/events/"+event.id,tokens.u1,"PATCH",{version:1,title:"Updated school meeting"}),env);
    assert.equal(edited.status,200);
    const editedEvent=(await edited.json()).event;
    assert.equal(editedEvent.createdBy,"u1");
    assert.equal(editedEvent.updatedBy,"u1");
    assert.equal(editedEvent.title,"Updated school meeting");
    assert.equal(db.sqlite.prepare("SELECT event_type FROM activity_events WHERE target_type='event' AND target_id=? ORDER BY created_at DESC LIMIT 1").get(event.id).event_type,"event.updated");
    const range=await handleEventsRequest(request("/api/events?workspaceId=w1&from=2026-11-23T00:00:00Z&to=2026-11-24T00:00:00Z",tokens.u1),env);
    assert.equal((await range.json()).events.length,1);
    const missingWorkspace=await handleEventsRequest(request("/api/events?from=2026-11-23T00:00:00Z&to=2026-11-24T00:00:00Z",tokens.u1),env);
    assert.equal(missingWorkspace.status,400);
    const wrongWorkspace=await handleEventsRequest(request("/api/events?workspaceId=w2&from=2026-11-23T00:00:00Z&to=2026-11-24T00:00:00Z",tokens.u1),env);
    assert.equal(wrongWorkspace.status,404);
    const workspaceViewer=await handleEventsRequest(request("/api/events?workspaceId=w1&from=2026-11-23T00:00:00Z&to=2026-11-24T00:00:00Z",tokens.u2),env);
    assert.equal((await workspaceViewer.json()).events.length,1);
    const outsider=await handleEventsRequest(request("/api/events/"+event.id,tokens.u3),env);
    assert.equal(outsider.status,404);
    const viewerEdit=await handleEventsRequest(request("/api/events/"+event.id,tokens.u2,"PATCH",{version:1,title:"No access"}),env);
    assert.equal(viewerEdit.status,403);
    const wrongLink=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{title:"Bad link",startsAt:"2026-11-23T09:00:00+08:00",endsAt:"2026-11-23T10:00:00+08:00",timezone:"Asia/Kuala_Lumpur",linkedNoteId:"n2"}),env);
    assert.equal(wrongLink.status,400);
  }finally{db.close();}
});

test("event deletion cancels linked pending reminders",async()=>{
  const{db,env,tokens}=seed();
  try{
    const created=await handleEventsRequest(request("/api/events",tokens.u1,"POST",{title:"Appointment",startsAt:"2026-11-23T09:00:00+08:00",endsAt:"2026-11-23T10:00:00+08:00",timezone:"Asia/Kuala_Lumpur"}),env);
    const event=(await created.json()).event;
    const reminder=await handleRemindersRequest(request("/api/reminders",tokens.u1,"POST",{eventId:event.id,title:"Leave home",dueAt:"2026-11-23T08:00:00+08:00",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(reminder.status,201);
    const reminderId=(await reminder.json()).reminder.id;
    const deleted=await handleEventsRequest(request("/api/events/"+event.id,tokens.u1,"DELETE",{version:1}),env);
    assert.equal(deleted.status,200);
    assert.equal(db.sqlite.prepare("SELECT status FROM reminders WHERE id=?").get(reminderId).status,"cancelled");
    const viewerCreate=await handleRemindersRequest(request("/api/reminders",tokens.u2,"POST",{workspaceId:"w1",title:"No access",dueAt:"2026-11-23T08:00:00+08:00",timezone:"Asia/Kuala_Lumpur"}),env);
    assert.equal(viewerCreate.status,403);
  }finally{db.close();}
});

test("cron delivers idempotent in-app reminders to workspace members",async()=>{
  const{db,env,tokens}=seed();
  try{
    const now=new Date().toISOString();
    db.sqlite.prepare("INSERT INTO reminders (id,workspace_id,title,due_at_utc,timezone,status,idempotency_key,created_by_user_id,created_at,updated_at) VALUES ('r1','w1','Pay school fee',?,'Asia/Kuala_Lumpur','pending','idem-r1','u1',?,?)").run(new Date(Date.now()-60000).toISOString(),now,now);
    const delivered=await deliverDueReminders(db);
    assert.equal(delivered,1);
    assert.equal(db.sqlite.prepare("SELECT status FROM reminders WHERE id='r1'").get().status,"delivered");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notifications WHERE workspace_id='w1' AND notification_type='reminder'").get().count,2);
    assert.equal(await deliverDueReminders(db),0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notifications WHERE workspace_id='w1' AND notification_type='reminder'").get().count,2);

    const inbox=await handleNotificationsRequest(request("/api/notifications",tokens.u1),env);
    const inboxPayload=await inbox.json();
    assert.equal(inboxPayload.notifications.length,1);
    assert.equal(inboxPayload.unreadCount,1);
    const readAll=await handleNotificationsRequest(request("/api/notifications/read-all",tokens.u1,"POST"),env);
    assert.equal(readAll.status,200);
    const afterRead=await handleNotificationsRequest(request("/api/notifications?unreadOnly=1",tokens.u1),env);
    assert.equal((await afterRead.json()).unreadCount,0);
    const otherUser=await handleNotificationsRequest(request("/api/notifications",tokens.u3),env);
    assert.equal((await otherUser.json()).notifications.length,0);
  }finally{db.close();}
});

test("cron cancels due reminders whose linked note was deleted",async()=>{
  const{db}=seed();
  try{
    const now=new Date().toISOString();
    db.sqlite.prepare("INSERT INTO reminders (id,workspace_id,note_id,title,due_at_utc,timezone,status,idempotency_key,created_by_user_id,created_at,updated_at) VALUES ('r2','w1','n1','Old note reminder',?,'Asia/Kuala_Lumpur','pending','idem-r2','u1',?,?)").run(new Date(Date.now()-60000).toISOString(),now,now);
    db.sqlite.prepare("UPDATE notes SET deleted_at=? WHERE id='n1'").run(now);
    assert.equal(await deliverDueReminders(db),0);
    assert.equal(db.sqlite.prepare("SELECT status FROM reminders WHERE id='r2'").get().status,"cancelled");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notifications WHERE resource_id='n1' AND notification_type='reminder'").get().count,0);
  }finally{db.close();}
});

test("notification preferences default to Malaysia timezone and save per-user quiet hours",async()=>{
  const{db,env,tokens}=seed();
  try{
    const defaults=await handleNotificationsRequest(request("/api/notifications/preferences",tokens.u1),env);
    assert.equal(defaults.status,200);
    assert.deepEqual((await defaults.json()).preferences,{pushEnabled:true,reminderPushEnabled:true,sharedNotePushEnabled:true,sharedNoteUpdatePushEnabled:true,eventPushEnabled:true,workspacePushEnabled:true,quietHoursStart:null,quietHoursEnd:null,timezone:"Asia/Kuala_Lumpur"});
    const saved=await handleNotificationsRequest(request("/api/notifications/preferences",tokens.u1,"PUT",{
      pushEnabled:true,reminderPushEnabled:false,sharedNotePushEnabled:true,sharedNoteUpdatePushEnabled:true,eventPushEnabled:true,workspacePushEnabled:true,quietHoursStart:"22:00",quietHoursEnd:"07:00",timezone:"Asia/Kuala_Lumpur"
    }),env);
    assert.equal(saved.status,200);
    assert.equal((await saved.json()).preferences.reminderPushEnabled,false);
    const other=await handleNotificationsRequest(request("/api/notifications/preferences",tokens.u2),env);
    assert.equal((await other.json()).preferences.reminderPushEnabled,true);
    const invalid=await handleNotificationsRequest(request("/api/notifications/preferences",tokens.u1,"PUT",{
      pushEnabled:true,reminderPushEnabled:true,sharedNotePushEnabled:true,sharedNoteUpdatePushEnabled:true,eventPushEnabled:true,workspacePushEnabled:true,quietHoursStart:"22:00",quietHoursEnd:null,timezone:"Asia/Kuala_Lumpur"
    }),env);
    assert.equal(invalid.status,400);
  }finally{db.close();}
});

test("notification preference updates reject cross-origin requests",async()=>{
  const{db,env,tokens}=seed();
  try{
    const response=await handleNotificationsRequest(new Request("https://kitanotes.test/api/notifications/preferences",{
      method:"PUT",headers:{cookie:"__Host-kitanotes_session="+tokens.u1,origin:"https://attacker.test","content-type":"application/json"},
      body:JSON.stringify({pushEnabled:true,reminderPushEnabled:true,sharedNotePushEnabled:true,sharedNoteUpdatePushEnabled:true,eventPushEnabled:true,workspacePushEnabled:true,quietHoursStart:null,quietHoursEnd:null,timezone:"Asia/Kuala_Lumpur"})
    }),env);
    assert.equal(response.status,403);
  }finally{db.close();}
});


test("iCalendar import is idempotent and export returns valid VEVENTs",async()=>{
 const {db,env,tokens}=seed();
 try{
  const ics=["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:school-meeting-1@example.test","DTSTART;TZID=Asia/Kuala_Lumpur:20261201T090000","DTEND;TZID=Asia/Kuala_Lumpur:20261201T100000","SUMMARY:School meeting","DESCRIPTION:Meet teacher","END:VEVENT","BEGIN:VEVENT","UID:public-holiday-1@example.test","DTSTART;VALUE=DATE:20261211","DTEND;VALUE=DATE:20261212","SUMMARY:Sultan of Selangor Birthday","END:VEVENT","END:VCALENDAR"].join("\r\n");
  const importRequest=()=>new Request("https://kitanotes.test/api/calendar/ics/import",{method:"POST",headers:{cookie:"__Host-kitanotes_session="+tokens.u1,origin:"https://kitanotes.test","content-type":"application/json"},body:JSON.stringify({workspaceId:"w1",ics})});
  const first=await handleCalendarIcsRequest(importRequest(),env);assert.equal(first.status,200);const payload=await first.json();assert.equal(payload.imported,2);assert.equal(payload.updated,0);
  const second=await handleCalendarIcsRequest(importRequest(),env);assert.equal(second.status,200);assert.equal((await second.json()).imported,0);
  const count=db.sqlite.prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE workspace_id='w1'").get().count;assert.equal(count,2);
  const exportResponse=await handleCalendarIcsRequest(new Request("https://kitanotes.test/api/calendar/ics/export?workspaceId=w1",{headers:{cookie:"__Host-kitanotes_session="+tokens.u1}}),env);
  assert.equal(exportResponse.status,200);const exported=await exportResponse.text();assert.ok(exported.includes("BEGIN:VCALENDAR"));assert.ok(exported.includes("SUMMARY:School meeting"));assert.ok(exported.includes("VALUE=DATE:20261211"));
  const roundTrip=await handleCalendarIcsRequest(new Request("https://kitanotes.test/api/calendar/ics/import",{method:"POST",headers:{cookie:"__Host-kitanotes_session="+tokens.u1,origin:"https://kitanotes.test","content-type":"application/json"},body:JSON.stringify({workspaceId:"w1",ics:exported})}),env);
  assert.equal(roundTrip.status,200);assert.equal((await roundTrip.json()).imported,0);assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE workspace_id='w1'").get().count,2);
  const preference=await handleCalendarIcsRequest(new Request("https://kitanotes.test/api/calendar/preferences",{headers:{cookie:"__Host-kitanotes_session="+tokens.u1}}),env);assert.equal((await preference.json()).holidayState,"selangor");
  const save=await handleCalendarIcsRequest(new Request("https://kitanotes.test/api/calendar/preferences",{method:"PUT",headers:{cookie:"__Host-kitanotes_session="+tokens.u1,origin:"https://kitanotes.test","content-type":"application/json"},body:JSON.stringify({holidayState:"johor"})}),env);assert.equal(save.status,200);assert.equal((await save.json()).holidayState,"johor");
 }finally{db.close();}
});


test("Malaysia holiday feed is state-specific and returns all-day public holidays",async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async input=>{
  assert.equal(String(input),"https://holidaywise.wee.my/my/sgr/nat-state.ics");
  return new Response(["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:selangor-day-2026","DTSTART;VALUE=DATE:20261211","DTEND;VALUE=DATE:20261212","SUMMARY:Birthday of the Sultan of Selangor","END:VEVENT","END:VCALENDAR"].join("\r\n"),{status:200,headers:{"content-type":"text/calendar"}});
 };
 try{
  const response=await handleCalendarIcsRequest(new Request("https://kitanotes.test/api/calendar/holidays?state=selangor&from=2026-12-01&to=2026-12-31"),{});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.events.length,2);const publicHoliday=result.events.find(event=>event.holidayType==="public");const schoolHoliday=result.events.find(event=>event.holidayType==="school");assert.equal(publicHoliday.title,"Birthday of the Sultan of Selangor");assert.equal(publicHoliday.allDay,true);assert.equal(schoolHoliday.title,"Cuti Akhir Persekolahan 2026 (Kumpulan B)");assert.equal(schoolHoliday.startsAt,"2026-12-04T16:00:00.000Z");assert.equal(schoolHoliday.endsAt,"2026-12-31T16:00:00.000Z");
 }finally{globalThis.fetch=originalFetch;}
});

test("KPM school holidays follow Group A dates for Kedah",async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(["BEGIN:VCALENDAR","VERSION:2.0","END:VCALENDAR"].join("\r\n"),{status:200,headers:{"content-type":"text/calendar"}});
 try{
  const response=await handleCalendarIcsRequest(new Request("https://kitanotes.test/api/calendar/holidays?state=kedah&from=2027-03-01&to=2027-03-31"),{});
  const result=await response.json();const school=result.events.find(event=>event.holidayType==="school");
  assert.equal(school.title,"Cuti Penggal 1 2027 (Kumpulan A)");
  assert.equal(school.startsAt,"2027-03-04T16:00:00.000Z");
  assert.equal(school.endsAt,"2027-03-13T16:00:00.000Z");
 }finally{globalThis.fetch=originalFetch;}
});

test("KPM school holidays remain available when the public holiday feed is unavailable",async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response("unavailable",{status:503});
 try{
  const response=await handleCalendarIcsRequest(new Request("https://kitanotes.test/api/calendar/holidays?state=selangor&from=2026-12-01&to=2026-12-31"),{});
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.sources.holidayWise,false);
  assert.equal(result.sources.kpm,true);
  assert.equal(result.events.length,1);
  assert.equal(result.events[0].holidayType,"school");
 }finally{globalThis.fetch=originalFetch;}
});


test("annual holiday sync caches HolidayWise public holidays and KPM school breaks",async()=>{
 const {db}=seed();const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async input=>{
  calls++;
  assert.match(String(input),/^https:\/\/holidaywise\.wee\.my\/my\/[a-z]+\/nat-state\.ics$/);
  return new Response(["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:selangor-day-2026","DTSTART;VALUE=DATE:20261211","DTEND;VALUE=DATE:20261212","SUMMARY:Birthday of the Sultan of Selangor","END:VEVENT","END:VCALENDAR"].join("\r\n"),{status:200,headers:{"content-type":"text/calendar"}});
 };
 try{
  const synced=await syncCalendarHolidayData(db,new Date("2026-11-23T00:00:00.000Z"));
  assert.equal(synced.states,16);assert.equal(synced.failedStates.length,0);assert.equal(calls,16);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM calendar_holiday_cache WHERE source='public' AND holiday_year=2026").get().count,16);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM calendar_holiday_cache WHERE source='school' AND holiday_year=2026").get().count,16);
  globalThis.fetch=async()=>{throw new Error("cache should be used");};
  const response=await handleCalendarIcsRequest(new Request("https://kitanotes.test/api/calendar/holidays?state=selangor&from=2026-01-01&to=2026-12-31"),{DB:db});
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.sources.holidayWise,true);
  assert.ok(result.events.some(event=>event.holidayType==="public"&&event.title==="Birthday of the Sultan of Selangor"));
  assert.ok(result.events.some(event=>event.holidayType==="school"&&event.title.includes("Cuti Akhir Persekolahan 2026")));
 }finally{globalThis.fetch=originalFetch;db.close();}
});


test("Selangor public holiday feed uses the SGR feed slug and caches a successful live fetch",async()=>{
 const {db}=seed();const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async input=>{
  calls++;
  assert.equal(String(input),"https://holidaywise.wee.my/my/sgr/nat-state.ics");
  return new Response(["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:selangor-day-2026","DTSTART;VALUE=DATE:20261211","DTEND;VALUE=DATE:20261212","SUMMARY:Birthday of the Sultan of Selangor","END:VEVENT","END:VCALENDAR"].join("\r\n"),{status:200,headers:{"content-type":"text/calendar"}});
 };
 try{
  const request=new Request("https://kitanotes.test/api/calendar/holidays?state=selangor&from=2026-01-01&to=2026-12-31");
  const response=await handleCalendarIcsRequest(request,{DB:db});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.sources.holidayWise,true);
  assert.equal(result.sources.publicHolidayCount,1);
  assert.equal(result.events.some(event=>event.title==="Birthday of the Sultan of Selangor"),true);
  assert.equal(calls,1);
  const cached=db.sqlite.prepare("SELECT events_json FROM calendar_holiday_cache WHERE state='selangor' AND holiday_year=2026 AND source='public'").get();
  assert.ok(cached);
  globalThis.fetch=async()=>{throw new Error("cached feed should avoid a network request");};
  const cachedResponse=await handleCalendarIcsRequest(request,{DB:db});
  assert.equal(cachedResponse.status,200);
  const cachedResult=await cachedResponse.json();
  assert.equal(cachedResult.sources.holidayWise,true);
  assert.equal(cachedResult.sources.publicHolidayCount,1);
 }finally{globalThis.fetch=originalFetch;db.close();}
});
