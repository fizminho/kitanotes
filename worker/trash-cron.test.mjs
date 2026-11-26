import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { purgeExpiredTrash } from "./trash-cron.ts";
test("purges only notes deleted at least 30 days ago",async()=>{
 const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY,deleted_at TEXT); CREATE TABLE workspace_membership_changes(changed_at TEXT)");
 const now=new Date("2026-11-27T00:00:00.000Z"),old=new Date(now.getTime()-31*86400000).toISOString(),recent=new Date(now.getTime()-29*86400000).toISOString();
 db.prepare("INSERT INTO notes VALUES (?,?)").run("old",old);db.prepare("INSERT INTO notes VALUES (?,?)").run("recent",recent);db.prepare("INSERT INTO notes VALUES (?,NULL)").run("active");
 const d1={prepare(sql){const statement=db.prepare(sql);return{bind(...values){return{run:async()=>{const result=statement.run(...values);return{meta:{changes:Number(result.changes)}};}};}};}};
 assert.equal(await purgeExpiredTrash(d1,now),1);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notes").get().n,2);db.close();
});
