// The Edge Function's APNs sender (supabase/functions/_shared), tested with a mocked APNs.
import { describe, expect, it } from "vitest";
import { apnsJwt, sendApns, type PushMessage } from "../../../supabase/functions/_shared/apns.ts";
import { deliver, messageFor, type ClaimedPush } from "../../../supabase/functions/_shared/deliver.ts";

const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function testKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

/** A fake APNs: answers each request from `replies` in order and records what was sent. */
function fakeApns(replies: [number, string?][]) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const [status, reason] = replies.shift() ?? [200];
    return new Response(reason ? JSON.stringify({ reason }) : null, { status });
  };
  return { fetchFn, calls };
}

const msg: PushMessage = { title: "T", body: "B", threadId: "round-1", collapseId: "note-1", data: { round_id: "round-1", golfer_id: "g", kind: "hole" } };
const TOKEN = "ab".repeat(32);

describe("APNs provider token", () => {
  it("is an ES256 JWT for the team, signed with the .p8 key", async () => {
    const { pem, publicKey } = await testKey();
    const jwt = await apnsJwt({ pem, keyId: "KEY123", teamId: "8424XCN267" }, 1_790_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({ iss: "8424XCN267", iat: 1_790_000_000 });
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${c}`));
    expect(valid).toBe(true);
  });
});

describe("sendApns", () => {
  it("posts an alert to the right host with the topic and collapse id", async () => {
    const { fetchFn, calls } = fakeApns([[200]]);
    expect(await sendApns(fetchFn, "jwt", "com.sunnysimms.fairwhere", TOKEN, "production", msg)).toEqual({ ok: true, env: "production" });
    expect(calls[0].url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    expect(calls[0].headers).toMatchObject({ authorization: "bearer jwt", "apns-topic": "com.sunnysimms.fairwhere", "apns-push-type": "alert", "apns-collapse-id": "note-1" });
    expect(calls[0].body).toEqual({ aps: { alert: { title: "T", body: "B" }, sound: "default", "thread-id": "round-1" }, round_id: "round-1", golfer_id: "g", kind: "hole" });
  });
  it("finds a debug build's token on sandbox when the environment isn't known", async () => {
    const { fetchFn, calls } = fakeApns([[400, "BadDeviceToken"], [200]]);
    expect(await sendApns(fetchFn, "jwt", "t", TOKEN, null, msg)).toEqual({ ok: true, env: "sandbox" });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.push.apple.com", "api.sandbox.push.apple.com"]);
  });
  it("marks uninstalled / bad tokens dead, but not throttling or outages", async () => {
    expect(await sendApns(fakeApns([[410, "Unregistered"]]).fetchFn, "j", "t", TOKEN, "production", msg)).toMatchObject({ ok: false, dead: true });
    expect(await sendApns(fakeApns([[400, "BadDeviceToken"]]).fetchFn, "j", "t", TOKEN, "sandbox", msg)).toMatchObject({ ok: false, dead: true });
    expect(await sendApns(fakeApns([[429, "TooManyRequests"]]).fetchFn, "j", "t", TOKEN, "production", msg)).toMatchObject({ ok: false, dead: false });
    expect(await sendApns(fakeApns([[503]]).fetchFn, "j", "t", TOKEN, "production", msg)).toMatchObject({ ok: false, dead: false });
  });
});

const row = (over: Partial<ClaimedPush> = {}): ClaimedPush => ({
  id: "n1", kind: "hole", hole: 9, eta: "2026-10-07T21:16:00Z", delta_min: 12, strokes: null, created_at: "2026-10-07T19:00:00Z",
  round_id: "r1", golfer_id: "g1", golfer_name: "Mike", course_name: "Redhawk Golf Club", token: TOKEN, env: null, tz: "America/New_York", ...over,
});

describe("deliver", () => {
  it("writes the same text as the app, with times in the recipient's zone", () => {
    expect(messageFor(row())).toMatchObject({ title: "Mike finished hole 9", body: "12 min behind pace · done ~5:16 PM", threadId: "r1", collapseId: "n1" });
    expect(messageFor(row({ tz: "America/Los_Angeles" })).body).toBe("12 min behind pace · done ~2:16 PM");
    expect(messageFor(row({ kind: "tee_off", hole: null })).body).toBe("Redhawk Golf Club");
  });
  it("sends each row, learns a token's environment once, and forgets dead tokens", async () => {
    const sent: string[] = [], fb: [string, string | null, boolean][] = [];
    const dead = "cd".repeat(32);
    const result = await deliver(
      [row({ id: "a" }), row({ id: "b" }), row({ id: "c", token: dead }), row({ id: "d", token: dead })],
      async (token, _env, m) => (sent.push(m.collapseId), token === dead ? { ok: false, status: 410, reason: "Unregistered", dead: true } : { ok: true, env: "sandbox" }),
      async (token, env, isDead) => void fb.push([token, env, isDead]),
    );
    expect(sent).toEqual(["a", "b", "c"]); // "d" skipped: its phone is gone
    expect(result).toEqual({ sent: 2, failed: 1, dead: 1 });
    expect(fb).toEqual([[TOKEN, "sandbox", false], [dead, null, true]]);
  });
});
