// Push sender: delivers new alerts (public.notifications) to watchers' iPhones over APNs.
// Woken by the database (notifications_kick trigger + the push-sweep minute job, via pg_net).
// Safe to call any time: claim_pushes stamps rows before sending, so nothing goes out twice.
//
// Secrets (supabase secrets set ...): APNS_KEY (the .p8 contents), APNS_KEY_ID, APNS_TEAM_ID,
// optional APNS_TOPIC (default com.sunnysimms.fairwhere). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from "npm:@supabase/supabase-js@2";
import { apnsJwt, sendApns } from "../_shared/apns.ts";
import { deliver, type ClaimedPush } from "../_shared/deliver.ts";

let cached: { jwt: string; at: number } | null = null;

Deno.serve(async () => {
  const pem = Deno.env.get("APNS_KEY"), keyId = Deno.env.get("APNS_KEY_ID"), teamId = Deno.env.get("APNS_TEAM_ID");
  // Without the key, leave alerts unclaimed (still shown in the app) rather than drop them.
  if (!pem || !keyId || !teamId) return Response.json({ skipped: "APNs key not configured" });
  const topic = Deno.env.get("APNS_TOPIC") ?? "com.sunnysimms.fairwhere";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("claim_pushes", { max_rows: 200 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as ClaimedPush[];
  if (!rows.length) return Response.json({ sent: 0 });

  if (!cached || Date.now() - cached.at > 50 * 60e3) cached = { jwt: await apnsJwt({ pem, keyId, teamId }), at: Date.now() };
  const jwt = cached.jwt;
  const result = await deliver(
    rows,
    (token, env, m) => sendApns(fetch, jwt, topic, token, env, m),
    async (token, env, dead) => {
      await db.rpc("push_feedback", { p_token: token, p_env: env, p_dead: dead });
    },
  );
  return Response.json(result);
});
