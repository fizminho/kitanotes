import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { consumeRateLimit, cleanupExpiredRateLimits } from "./rate-limit.ts";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0007_request_rate_limits.sql", import.meta.url), "utf8"));
  const db = { prepare(sql) { return { bind(...values) { return {
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    run: async () => sqlite.prepare(sql).run(...values)
  }; } }; } };
  return { sqlite, db };
}

test("fixed window allows the configured number and rejects the next request", async () => {
  const { sqlite, db } = database();
  try {
    const now = 1_800_000_000_000;
    assert.equal((await consumeRateLimit(db, "invite:user-1", 2, 60_000, now)).allowed, true);
    assert.equal((await consumeRateLimit(db, "invite:user-1", 2, 60_000, now + 1)).remaining, 0);
    const blocked = await consumeRateLimit(db, "invite:user-1", 2, 60_000, now + 2);
    assert.deepEqual(blocked, { allowed: false, remaining: 0, retryAfterSeconds: 60 });
    assert.equal(sqlite.prepare("SELECT request_count FROM request_rate_limits WHERE bucket_key=?").get("invite:user-1").request_count, 2);
  } finally { sqlite.close(); }
});

test("a new window resets the counter and expired buckets can be cleaned", async () => {
  const { sqlite, db } = database();
  try {
    const now = 1_800_000_000_000;
    await consumeRateLimit(db, "login:ip-hash", 1, 60_000, now);
    assert.equal((await consumeRateLimit(db, "login:ip-hash", 1, 60_000, now + 60_000)).allowed, true);
    await cleanupExpiredRateLimits(db, now + 180_001);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM request_rate_limits").get().count, 0);
  } finally { sqlite.close(); }
});
