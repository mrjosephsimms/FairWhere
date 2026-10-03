import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { onResume } from "./native";
import type { CourseData } from "./courses";
import { getCourses, getProfiles, listFriendships, listVisibleRounds, type Friendship, type Profile, type Round } from "./db";

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
  loaded: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Rounds, friendships and the profiles/courses they reference, kept fresh by
 * Supabase Realtime (RLS decides which changes we receive), app resume, and a
 * slow fallback poll.
 */
export function useLiveData(me: string): LiveData {
  const [state, setState] = useState<Omit<LiveData, "reload">>({
    rounds: [],
    friendships: [],
    profiles: new Map(),
    courses: new Map(),
    loaded: false,
    error: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    try {
      const [rounds, friendships] = await Promise.all([listVisibleRounds(), listFriendships()]);
      const ids = new Set([me, ...rounds.map((r) => r.user_id)]);
      friendships.forEach((f) => (ids.add(f.user_id), ids.add(f.friend_id)));
      const [profiles, courses] = await Promise.all([getProfiles([...ids]), getCourses(rounds.map((r) => r.course_id))]);
      setState({
        rounds,
        friendships,
        profiles: new Map(profiles.map((p) => [p.id, p])),
        courses: new Map(courses),
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
