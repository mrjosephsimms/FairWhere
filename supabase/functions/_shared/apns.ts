// Apple Push Notification service, token-based (.p8 key). Plain WebCrypto + fetch, with fetch
// passed in so it's testable without Apple (app/src/lib/pushSender.test.ts). Runs in Deno.

export type ApnsEnv = "sandbox" | "production";
export interface ApnsKey {
  keyId: string;
  teamId: string;
  /** The .p8 file's contents (PEM, "-----BEGIN PRIVATE KEY-----..."). */
  pem: string;
}

export const apnsHost = (env: ApnsEnv) =>
  env === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s: string) => new TextEncoder().encode(s);

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

/** Provider token (ES256 JWT). Apple accepts one for up to an hour; reuse it ~50 min. */
export async function apnsJwt(key: ApnsKey, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = b64url(utf8(JSON.stringify({ alg: "ES256", kid: key.keyId })));
  const claims = b64url(utf8(JSON.stringify({ iss: key.teamId, iat: nowSec })));
  const signingKey = await crypto.subtle.importKey("pkcs8", pemToDer(key.pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto's ECDSA signature is already raw r||s, which is what ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, utf8(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(sig)}`;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Groups a round's alerts together on the lock screen. */
  threadId: string;
  /** One alert id: a resend replaces rather than duplicates. */
  collapseId: string;
  /** Extra keys for the app (tap handling). */
  data: Record<string, string>;
}

export const apnsPayload = (m: PushMessage) => ({
  aps: { alert: { title: m.title, body: m.body }, sound: "default", "thread-id": m.threadId },
  ...m.data,
});

export type SendResult =
  | { ok: true; env: ApnsEnv }
  | { ok: false; status: number; reason: string; dead: boolean };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Send one push. When the token's environment isn't known yet, try production then sandbox
 * (a debug build's token is "BadDeviceToken" on production). `dead` = forget this token.
 */
export async function sendApns(fetchFn: Fetch, jwt: string, topic: string, token: string, env: ApnsEnv | null, m: PushMessage): Promise<SendResult> {
  const tries: ApnsEnv[] = env ? [env] : ["production", "sandbox"];
  let last: SendResult = { ok: false, status: 0, reason: "not sent", dead: false };
  for (const e of tries) {
    const res = await fetchFn(`${apnsHost(e)}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-collapse-id": m.collapseId.slice(0, 64),
      },
      body: JSON.stringify(apnsPayload(m)),
    });
    if (res.status === 200) return { ok: true, env: e };
    const reason = String(((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? res.status);
    if (!env && e === "production" && reason === "BadDeviceToken") continue; // maybe a sandbox token
    const dead = res.status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(reason);
    last = { ok: false, status: res.status, reason, dead };
    break;
  }
  return last;
}
