import test from "node:test";
import assert from "node:assert/strict";
import { buildPushContent, formatPushWhen, validPushTag, validPushUrl } from "./push-content.ts";
import { claimNoteEditPush } from "./push.ts";

test("note builders distinguish created, edited, archived, deleted and restored",()=>{
 const base={kind:"shared_note_update",actor:"Aina",workspace:"Family",itemTitle:"Groceries",resourceType:"note",resourceId:"n1"};
 for(const [subtype,verb] of [["created","added"],["edited","edited"],["archived","archived"],["deleted","deleted"],["restored","restored"]]){
  const result=buildPushContent({...base,subtype},"detailed");
  assert.equal(result.title,"Aina "+verb+" a note");
  assert.equal(result.body,"Groceries · Family");
 }
});

test("note builder uses Untitled note and safely falls back for missing actor or workspace",()=>{
 const base={kind:"shared_note",subtype:"created",actor:"Aina",workspace:"Family"};
 assert.deepEqual(buildPushContent({...base,itemTitle:""},"detailed"),{title:"Aina added a note",body:"Untitled note · Family"});
 assert.deepEqual(buildPushContent({...base,actor:null},"detailed"),{title:"New shared note",body:"Someone added a note in a shared workspace. Open KitaNotes to view it."});
 assert.deepEqual(buildPushContent({...base,workspace:null},"detailed"),{title:"New shared note",body:"Someone added a note in a shared workspace. Open KitaNotes to view it."});
});

test("event builders distinguish created, moved, updated and cancelled",()=>{
 const base={kind:"event",actor:"Hafiz",workspace:"Family",itemTitle:"School pickup",when:"2026-12-02T07:00:00Z"};
 assert.match(buildPushContent({...base,subtype:"created"},"detailed").title,/^New event:/);
 assert.match(buildPushContent({...base,subtype:"moved"},"detailed").title,/^Event moved:/);
 assert.match(buildPushContent({...base,subtype:"updated"},"detailed").title,/^Event updated:/);
 assert.match(buildPushContent({...base,subtype:"cancelled"},"detailed").title,/^Event cancelled:/);
 assert.equal(buildPushContent({...base,subtype:"moved"},"detailed").body.startsWith("Now "),true);
 assert.equal(buildPushContent({...base,subtype:"cancelled"},"detailed").body.startsWith("Was "),true);
});

test("reminder and workspace builders use the catalogue wording",()=>{
 assert.deepEqual(buildPushContent({kind:"reminder",workspace:"Family",itemTitle:"Medicine"}, "detailed"),{title:"Reminder: Medicine",body:"Due now · Family"});
 assert.deepEqual(buildPushContent({kind:"workspace",subtype:"role_changed",workspace:"Family",role:"editor"},"detailed"),{title:"Your role changed in Family",body:"You are now Editor."});
 assert.deepEqual(buildPushContent({kind:"workspace",subtype:"member_removed",workspace:"Family"},"detailed"),{title:"Removed from Family",body:"You no longer have access to this workspace."});
});

test("generic mode exactly preserves the legacy catalogue",()=>{
 assert.deepEqual(buildPushContent({kind:"event",subtype:"created",actor:"Aina",workspace:"Family",itemTitle:"Secret",when:"2026-12-02T07:00:00Z"},"generic"),{title:"Calendar activity",body:"A calendar event was created, changed or cancelled. Open KitaNotes to review it."});
});

test("long, multiline, markdown and emoji-heavy text is sanitized and truncated safely",()=>{
 const result=buildPushContent({kind:"shared_note",subtype:"created",actor:"Aina",workspace:"Family",itemTitle:"**🚀 Rocket**\n"+("verylongword ".repeat(20))},"detailed");
 assert.ok(Array.from(result.title).length<=60);
 assert.ok(Array.from(result.body).length<=120);
 assert.doesNotMatch(result.body,/[\r\n]|\*\*/);
 assert.match(result.body,/🚀 Rocket/);
});

test("non-Latin content is preserved",()=>{
 const result=buildPushContent({kind:"shared_note",subtype:"created",actor:"山田",workspace:"家族",itemTitle:"買い物リスト"},"detailed");
 assert.deepEqual(result,{title:"山田 added a note",body:"買い物リスト · 家族"});
});

test("recipient timezone controls event time formatting",()=>{
 const date="2026-12-02T07:00:00Z";
 assert.match(formatPushWhen(date,"Asia/Kuala_Lumpur")??"",/3:00 PM/);
 assert.match(formatPushWhen(date,"America/New_York")??"",/2:00 AM/);
});

test("URL and tag validation reject unsafe or malformed values",()=>{
 assert.equal(validPushUrl("/?workspaceId=abc"),true);
 assert.equal(validPushUrl("//evil.com"),false);
 assert.equal(validPushUrl("javascript:alert(1)"),false);
 assert.equal(validPushUrl("/\\\\evil.com"),false);
 assert.equal(validPushTag("note:abc-123"),true);
 assert.equal(validPushTag("note:abc/123"),false);
 assert.equal(validPushTag("x".repeat(65)),false);
});

test("note edit debounce allows one send per recipient in 120 seconds, then allows another",async()=>{
 let expiresAt=0;
 const db={prepare(){return{bind(key,expires,now){return{first:async()=>{const current=Date.parse(now);if(expiresAt>current)return null;expiresAt=Date.parse(expires);return{debounce_key:key};}};}};}};
 assert.equal(await claimNoteEditPush(db,"note-1","actor-1","recipient-1",1000),true);
 for(let i=1;i<10;i++)assert.equal(await claimNoteEditPush(db,"note-1","actor-1","recipient-1",1000+i*10000),false);
 assert.equal(await claimNoteEditPush(db,"note-1","actor-1","recipient-1",122000),true);
 assert.equal(await claimNoteEditPush(db,"note-1","actor-2","recipient-1",123000),true);
 assert.equal(await claimNoteEditPush(db,"note-1","actor-1","recipient-2",124000),true);
});
