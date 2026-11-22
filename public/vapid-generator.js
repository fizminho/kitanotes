const generateButton = document.querySelector("#generate");
const status = document.querySelector("#status");
const publicOutput = document.querySelector("#publicKey");
const privateOutput = document.querySelector("#privateKey");
const subjectInput = document.querySelector("#subject");
const copySubjectButton = document.querySelector("#copySubject");
const copyButtons = [...document.querySelectorAll("[data-copy]")];

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function copyValue(value, button) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = original; }, 1600);
  } catch {
    status.textContent = "Copy was blocked by the browser. Select the field and copy it manually.";
  }
}

generateButton.addEventListener("click", async () => {
  generateButton.disabled = true;
  status.textContent = "Generating keys on this device…";
  publicOutput.value = "";
  privateOutput.value = "";
  copyButtons.forEach(button => { button.disabled = true; });
  copySubjectButton.disabled = true;
  try {
    if (!globalThis.crypto?.subtle) throw new Error("Secure browser cryptography is unavailable. Open this page over HTTPS in Safari.");
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    if (!jwk.x || !jwk.y || !jwk.d) throw new Error("The browser did not return a complete key pair.");
    const publicBytes = new Uint8Array(65);
    publicBytes[0] = 4;
    publicBytes.set(base64UrlToBytes(jwk.x), 1);
    publicBytes.set(base64UrlToBytes(jwk.y), 33);
    publicOutput.value = bytesToBase64Url(publicBytes);
    privateOutput.value = jwk.d;
    copyButtons.forEach(button => { button.disabled = false; });
    copySubjectButton.disabled = false;
    status.textContent = "Keys generated locally. Copy them into Cloudflare now. This page does not save them.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Unable to generate keys in this browser.";
  } finally {
    generateButton.disabled = false;
  }
});

copyButtons.forEach(button => button.addEventListener("click", () => {
  const field = document.getElementById(button.dataset.copy);
  copyValue(field.value, button);
}));
copySubjectButton.addEventListener("click", () => copyValue(subjectInput.value.trim(), copySubjectButton));
