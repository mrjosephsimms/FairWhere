// Turn claimed alerts (public.claim_pushes rows) into pushes. Pure apart from the injected
// send / feedback, so it's tested without Apple or a database.
import { clockIn, describeNote, type NoteKind } from "./notes.ts";
import type { ApnsEnv, PushMessage, SendResult } from "./apns.ts";

export interface ClaimedPush {
  id: string;
  kind: NoteKind;
  hole: number | null;
  eta: string | null;
  delta_min: number | null;
  strokes: number | null;
  created_at: string;
  round_id: string;
  golfer_id: string;
  golfer_name: string;
  course_name: string;
  token: string;
  env: ApnsEnv | null;
  tz: string;
}

export function messageFor(p: ClaimedPush): PushMessage {
  const { title, body } = describeNote(p, p.golfer_name, p.course_name, clockIn(p.tz));
  return { title, body, threadId: p.round_id, collapseId: p.id, data: { round_id: p.round_id, golfer_id: p.golfer_id, kind: p.kind } };
}

export async function deliver(
  rows: ClaimedPush[],
  send: (token: string, env: ApnsEnv | null, m: PushMessage) => Promise<SendResult>,
  feedback: (token: string, env: ApnsEnv | null, dead: boolean) => Promise<void>,
): Promise<{ sent: number; failed: number; dead: number }> {
  let sent = 0, failed = 0;
  const learned = new Map<string, ApnsEnv>(), deadTokens = new Set<string>();
  for (const p of rows) {
    if (deadTokens.has(p.token)) continue;
    const r = await send(p.token, learned.get(p.token) ?? p.env, messageFor(p));
    if (r.ok) {
      sent++;
      if (!p.env && !learned.has(p.token)) learned.set(p.token, r.env);
    } else {
      failed++;
      if (r.dead) deadTokens.add(p.token);
    }
  }
  for (const [token, env] of learned) if (!deadTokens.has(token)) await feedback(token, env, false);
  for (const token of deadTokens) await feedback(token, null, true);
  return { sent, failed, dead: deadTokens.size };
}
