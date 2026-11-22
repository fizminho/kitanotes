import test from "node:test";
import assert from "node:assert/strict";
import { defaultReminderDateTime } from "../src/calendar-utils.ts";

test("defaults to exactly one calendar day before the event in its timezone",()=>{
  assert.equal(defaultReminderDateTime("2026-11-25T09:30","Asia/Kuala_Lumpur",new Date("2026-11-23T00:00:00.000Z")),"2026-11-24T09:30");
});

test("uses a near-future reminder when the one-day-before time has already passed",()=>{
  assert.equal(defaultReminderDateTime("2026-11-23T18:00","Asia/Kuala_Lumpur",new Date("2026-11-23T02:00:00.000Z")),"2026-11-23T10:05");
});

test("returns an empty value for an invalid event start",()=>{
  assert.equal(defaultReminderDateTime("not-a-date"),"");
});
