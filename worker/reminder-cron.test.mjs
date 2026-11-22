import test from "node:test";
import assert from "node:assert/strict";
import { formatReminderDueAt } from "./reminder-cron.ts";

test("formats UTC reminder timestamps in Malaysia local time", () => {
  assert.equal(
    formatReminderDueAt("2026-11-22T17:16:00.000Z", "Asia/Kuala_Lumpur"),
    "Mon, 23 Nov 2026, 1:16 AM MYT"
  );
});

test("formats reminder timestamps using the reminder's saved timezone", () => {
  assert.equal(
    formatReminderDueAt("2026-11-22T17:16:00.000Z", "Asia/Singapore"),
    "Mon, 23 Nov 2026, 1:16 AM GMT+8"
  );
});

test("falls back to Malaysia time for an invalid timezone", () => {
  assert.equal(
    formatReminderDueAt("2026-11-22T17:16:00.000Z", "Not/A_Timezone"),
    "Mon, 23 Nov 2026, 1:16 AM MYT"
  );
});
