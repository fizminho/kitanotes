import test from "node:test";
import assert from "node:assert/strict";
import { pollDelay } from "../src/poll-scheduler.ts";
test("shared poll scheduler backs off with bounded jitter",()=>{
 assert.equal(pollDelay(30000,0,0.5),30000);
 assert.equal(pollDelay(30000,1,0.5),60000);
 assert.equal(pollDelay(30000,5,0.5),60000);
 assert.equal(pollDelay(30000,0,0),27000);
 assert.equal(pollDelay(30000,0,1),33000);
});
