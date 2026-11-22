import { webcrypto } from "node:crypto";

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
const publicBytes = new Uint8Array(65);
publicBytes[0] = 4;
const decode = value => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
publicBytes.set(decode(jwk.x), 1);
publicBytes.set(decode(jwk.y), 33);
const encode = value => Buffer.from(value).toString("base64url");
console.log("VAPID_PUBLIC_KEY=" + encode(publicBytes));
console.log("VAPID_PRIVATE_KEY=" + jwk.d);
console.log("VAPID_SUBJECT=mailto:admin@example.com");
console.log("\nStore VAPID_PRIVATE_KEY as a Worker Secret. VAPID_PUBLIC_KEY and VAPID_SUBJECT are plain-text Worker variables. Replace the example contact with an address you control.");