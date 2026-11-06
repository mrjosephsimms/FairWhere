// Sign in with Apple (web flow) client secret for Supabase: an ES256 JWT signed with the
// FairWhere SIWA key. Apple caps it at 6 months: re-run before EXPIRES and paste/PATCH again.
import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
const TEAM = "8424XCN267", KEY_ID = "Z5MYL83ZNJ", SERVICES_ID = "com.sunnysimms.fairwhere.signin";
const pem = readFileSync(`${process.env.HOME}/SaleMap/.apple/AuthKey_${KEY_ID}.p8`, "utf8");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000), exp = now + 180 * 24 * 3600;
const data = `${b64({ alg: "ES256", kid: KEY_ID })}.${b64({ iss: TEAM, iat: now, exp, aud: "https://appleid.apple.com", sub: SERVICES_ID })}`;
const sig = createSign("SHA256").update(data).sign({ key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" });
process.stdout.write(`${data}.${sig.toString("base64url")}`);
process.stderr.write(`expires ${new Date(exp * 1000).toISOString().slice(0, 10)}\n`);
