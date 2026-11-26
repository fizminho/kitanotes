import test from "node:test";
import assert from "node:assert/strict";
import { pollDelay } from "./poll-scheduler.ts";
test("poll delay applies bounded exponential backoff and jitter",()=>{
 assert.equal(pollDelay(30000,0,0.5),30000);
 assert.equal(pollDelay(30000,1,0.5),60000);
 assert.equal(pollDelay(30000,5,0.5),60000);
 assert.equal(pollDelay(30000,0,0),27000);
 assert.equal(pollDelay(30000,0,1),33000);
});
