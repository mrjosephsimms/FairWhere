import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { onResume } from "./native";
import type { CourseData } from "./courses";
import {
  getCourses, getPlaysFor, getProfiles, getScoresFor, listFriendships, listNotes, listShares, listSpots, listVisibleRounds, listWatches,
  type Friendship, type GamePlay, type LocationShare, type Note, type Profile, type Round, type Spot, type Watch,
} from "./db";

export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

/** Re-render every `ms` so ETAs and "updated N min ago" keep ticking without writes. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export interface LiveData {
  rounds: Round[];
  friendships: Friendship[];
  profiles: Map<string, Profile>;
  courses: Map<string, CourseData>;
  /** Scorecards for the visible rounds: round id -> hole -> strokes. */
  scores: Map<string, Map<number, number>>;
  /** "Play this hole" results on the visible rounds, oldest first. */
  plays: GamePlay[];
  /** Your alert settings for friends, and friends' settings for you. */
  watches: Watch[];
  /** Alerts sent to you, newest first. */
  notes: Note[];
  /** Everyday location shares you've given and been given (active only). */
  shares: LocationShare[];
  /** Everyday positions you can see (people sharing with you, and your own). */
  spots: Spot[];
  loaded: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Rounds, friendships, scorecards and the profiles/courses they reference, kept fresh by
 * Supabase Realtime (RLS decides which changes we receive), app resume, and a
 * slow fallback poll.
 */
export function useLiveData(me: string): LiveData {
  const [state, setState] = useState<Omit<LiveData, "reload">>({
    rounds: [],
    friendships: [],
    profiles: new Map(),
    courses: new Map(),
    scores: new Map(),
    plays: [],
    watches: [],
    notes: [],
    shares: [],
    spots: [],
    loaded: false,
    error: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    try {
      const [rounds, friendships, watches, notes, shares, spots] = await Promise.all([
        listVisibleRounds(), listFriendships(), listWatches(), listNotes(), listShares(), listSpots(),
      ]);
      const roundIds = rounds.map((r) => r.id);
      const [courses, scores, plays] = await Promise.all([
        getCourses(rounds.map((r) => r.course_id)),
        getScoresFor(roundIds),
        getPlaysFor(roundIds),
      ]);
      const ids = new Set([me, ...rounds.map((r) => r.user_id), ...plays.map((p) => p.player_id), ...watches.map((w) => w.watcher_id)]);
      friendships.forEach((f) => (ids.add(f.user_id), ids.add(f.friend_id)));
      const profiles = await getProfiles([...ids]);
      setState({
        rounds,
        friendships,
        profiles: new Map(profiles.map((p) => [p.id, p])),
        courses: new Map(courses),
        scores,
        plays,
        watches,
        notes,
        shares,
        spots,
        loaded: true,
        error: null,
      });
    } catch (e) {
      setState((s) => ({ ...s, loaded: true, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [me]);

  const reload = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 250);
  }, [load]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`live-${me}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "round_scores" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_plays" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "watches" }, reload)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "location_shares" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, reload)
      .subscribe();
    const offResume = onResume(reload);
    const poll = setInterval(load, 90000);
    return () => {
      supabase.removeChannel(channel);
      offResume();
      clearInterval(poll);
      clearTimeout(timer.current);
    };
  }, [me, load, reload]);

  return { ...state, reload };
}

/** Run an async mutation with busy/error state; calls onDone (usually reload) on success. */
export function useAction(onDone?: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}
