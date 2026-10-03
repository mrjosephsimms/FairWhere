// Typed data access. Every read is filtered by RLS on the server
// (supabase/migrations/20261003000001_init.sql); nothing here is a security boundary.
import { supabase } from "./supabase";
import type { CourseData } from "./courses";
import type { Mode } from "./pace";

export interface Profile {
  id: string;
  display_name: string;
  friend_code: string;
}

export interface Friendship {
  user_id: string; // asked
  friend_id: string; // was asked
  status: "pending" | "accepted";
  created_at: string;
}

export interface Round {
  id: string;
  user_id: string;
  course_id: string;
  nines: string[] | null;
  tee_time: string;
  target_minutes: number;
  hole: number;
  hole_started_at: string;
  hole_fraction: number | null;
  last_lat: number | null;
  last_lng: number | null;
  last_fix_at: string | null;
  status: "live" | "done" | "cancelled";
  visibility: "friends" | "selected";
  mode: Mode;
  /** Set while the golfer seems to be hunting for a ball (lib/onCourse.ts). */
  searching_since: string | null;
  finished_at: string | null;
  updated_at: string;
}

/** Throw on error; on success `data` is present for selects/RPCs (writes without .select() ignore it). */
function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ------------------------------------------------------------------ profiles

export async function getProfiles(ids: string[]): Promise<Profile[]> {
  if (!ids.length) return [];
  return check(await supabase.from("profiles").select("id, display_name, friend_code").in("id", ids));
}

export async function setDisplayName(id: string, name: string) {
  check(await supabase.from("profiles").update({ display_name: name.trim().slice(0, 40) }).eq("id", id));
}

// ------------------------------------------------------------------ friends

export async function listFriendships(): Promise<Friendship[]> {
  return check(await supabase.from("friendships").select("*").order("created_at", { ascending: false }));
}

export async function requestFriend(code: string): Promise<"pending" | "accepted"> {
  return check(await supabase.rpc("request_friend", { code }));
}

export async function respondFriend(requester: string, accept: boolean) {
  check(await supabase.rpc("respond_friend", { requester, accept }));
}

export async function removeFriendship(f: Pick<Friendship, "user_id" | "friend_id">) {
  check(await supabase.from("friendships").delete().eq("user_id", f.user_id).eq("friend_id", f.friend_id));
}

// ------------------------------------------------------------------ courses

const courseCache = new Map<string, CourseData>();

export async function listCourses(): Promise<CourseData[]> {
  const rows = check(await supabase.from("courses").select("data").order("name"));
  const list = (rows as { data: CourseData }[]).map((r) => r.data);
  list.forEach((c) => courseCache.set(c.id, c));
  return list;
}

export async function getCourses(ids: string[]): Promise<Map<string, CourseData>> {
  const missing = [...new Set(ids)].filter((id) => !courseCache.has(id));
  if (missing.length) {
    const rows = check(await supabase.from("courses").select("data").in("id", missing));
    (rows as { data: CourseData }[]).forEach((r) => courseCache.set(r.data.id, r.data));
  }
  return courseCache;
}

// ------------------------------------------------------------------- rounds

/** Rounds worth showing: live ones, and ones finished in the last 4h (RLS applies the same window to friends). */
export async function listVisibleRounds(): Promise<Round[]> {
  const since = new Date(Date.now() - 4 * 3600e3).toISOString();
  return check(
    await supabase
      .from("rounds")
      .select("*")
      .or(`status.eq.live,and(status.eq.done,finished_at.gt."${since}")`)
      .order("tee_time"),
  );
}

export interface StartRound {
  course_id: string;
  nines: string[] | null;
  tee_time: Date;
  target_minutes: number;
  mode: Mode;
  visibility: "friends" | "selected";
  viewers: string[];
}

export async function startRound(s: StartRound): Promise<Round> {
  const teeMs = s.tee_time.getTime();
  const round: Round = check(
    await supabase
      .from("rounds")
      .insert({
        course_id: s.course_id,
        nines: s.nines,
        tee_time: s.tee_time.toISOString(),
        target_minutes: s.target_minutes,
        mode: s.mode,
        hole: 1,
        hole_started_at: new Date(Math.max(teeMs, Date.now())).toISOString(),
        visibility: s.visibility,
      })
      .select()
      .single(),
  );
  if (s.visibility === "selected" && s.viewers.length) {
    const res = await supabase.from("round_viewers").insert(s.viewers.map((viewer_id) => ({ round_id: round.id, viewer_id })));
    if (res.error) {
      // Don't leave a "selected" round that nobody can see.
      await supabase.from("rounds").update({ status: "cancelled" }).eq("id", round.id);
      throw new Error(res.error.message);
    }
  }
  return round;
}

export async function setHole(id: string, hole: number) {
  check(
    await supabase
      .from("rounds")
      .update({ hole, hole_started_at: new Date().toISOString(), hole_fraction: null })
      .eq("id", id),
  );
}

/** Live GPS: position, progress along the hole, ball hunt, and (on auto-advance) the hole. */
export async function updateRoundPosition(
  id: string,
  patch: Partial<Pick<Round, "last_lat" | "last_lng" | "last_fix_at" | "hole_fraction" | "searching_since" | "hole" | "hole_started_at">>,
) {
  check(await supabase.from("rounds").update(patch).eq("id", id).eq("status", "live"));
}

// ------------------------------------------------------------------- scores

/** Your scorecard for a round: hole -> strokes (private to you, RLS). */
export async function getScores(roundId: string): Promise<Map<number, number>> {
  const rows: { hole: number; strokes: number }[] = check(await supabase.from("round_scores").select("hole, strokes").eq("round_id", roundId));
  return new Map(rows.map((r) => [r.hole, r.strokes]));
}

/** Scorecards for several rounds (yours, and friends' you can see): round id -> hole -> strokes. */
export async function getScoresFor(roundIds: string[]): Promise<Map<string, Map<number, number>>> {
  const out = new Map<string, Map<number, number>>();
  if (!roundIds.length) return out;
  const rows: { round_id: string; hole: number; strokes: number }[] = check(
    await supabase.from("round_scores").select("round_id, hole, strokes").in("round_id", roundIds),
  );
  for (const r of rows) {
    if (!out.has(r.round_id)) out.set(r.round_id, new Map());
    out.get(r.round_id)!.set(r.hole, r.strokes);
  }
  return out;
}

export async function setScore(roundId: string, hole: number, strokes: number) {
  check(await supabase.from("round_scores").upsert({ round_id: roundId, hole, strokes, updated_at: new Date().toISOString() }));
}

// --------------------------------------------------------------- hole game

export interface GamePlay {
  id: string;
  round_id: string;
  hole: number;
  player_id: string;
  strokes: number;
  created_at: string;
}

/** Everyone's "play this hole" results on the rounds you can see. */
export async function getPlaysFor(roundIds: string[]): Promise<GamePlay[]> {
  if (!roundIds.length) return [];
  return check(await supabase.from("game_plays").select("*").in("round_id", roundIds).order("created_at"));
}

export async function recordPlay(roundId: string, hole: number, strokes: number) {
  check(await supabase.from("game_plays").insert({ round_id: roundId, hole, strokes }));
}

/** Finish (shows "Finished hh:mm" to friends for 4h) or stop sharing (disappears). */
export async function endRound(id: string, how: "done" | "cancelled") {
  check(await supabase.from("rounds").update({ status: how }).eq("id", id));
}
