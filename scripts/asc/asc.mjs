// Minimal App Store Connect API client (ES256 JWT from the team key in ~/.appstoreconnect).
import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
const KEY_ID = "86Y3797TN2", ISSUER = "6bb49b23-a1d9-4fb5-b9d2-df5a8e02edff";
const pem = readFileSync(`${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`, "utf8");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: "ES256", kid: KEY_ID, typ: "JWT" })}.${b64({ iss: ISSUER, iat: now, exp: now + 1100, aud: "appstoreconnect-v1" })}`;
  const sig = createSign("SHA256").update(data).sign({ key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" });
  return `${data}.${sig.toString("base64url")}`;
}
export async function asc(method, path, body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { authorization: `Bearer ${jwt()}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${json?.errors?.map((e) => e.detail || e.title).join("; ") || text.slice(0, 300)}`);
  return json;
}
