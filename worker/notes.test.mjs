import test from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "./notes.ts";

test("bounded JSON reader accepts valid object payloads", async () => {
  const request = new Request("https://kitanotes.test/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Test note", content: "Hello" })
  });
  assert.deepEqual(await readJsonBody(request), { title: "Test note", content: "Hello" });
});

test("bounded JSON reader rejects invalid JSON and non-object payloads", async () => {
  const invalid = new Request("https://kitanotes.test/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  const array = new Request("https://kitanotes.test/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: "[]" });
  assert.equal(await readJsonBody(invalid), null);
  assert.equal(await readJsonBody(array), null);
});

test("bounded JSON reader rejects oversized payloads while streaming", async () => {
  const request = new Request("https://kitanotes.test/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "x".repeat(70_000) })
  });
  assert.equal(await readJsonBody(request), null);
});
