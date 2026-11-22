import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("health endpoint is service-specific and does not expose credentials", async () => {
 const source=await readFile(new URL("./index.ts",import.meta.url),"utf8");
 assert.match(source,/service:"kitanotes"/);
 assert.match(source,/url\.pathname==="\/api\/health"/);
 assert.match(source,/NOT_IMPLEMENTED/);
 assert.doesNotMatch(source,/(?:AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA )?PRIVATE KEY-----)/);
});
