import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseConfigured } from "./lib/supabase";
import { initDeepLinks } from "./lib/native";
import { useAction, useLiveData, useNow, useSession } from "./lib/hooks";
import { endRound } from "./lib/db";
import { roundInfo, visibleRounds } from "./lib/roundInfo";
import { courseBounds, roundPosition } from "./lib/geo";
import { StopConfirm } from "./components/RoundView";
import { MapView, type CourseOverlay, type MapFocus, type MapPin } from "./components/MapView";
import { Sheet, type Detent } from "./components/Sheet";
import { SignIn } from "./screens/SignIn";
import { People, RoundDetail } from "./screens/People";
import { MyRound } from "./screens/MyRound";
import { Me } from "./screens/Me";

type Tab = "people" | "round" | "me";

export default function App() {
  const session = useSession();
  const now = useNow();
  const [invite, setInvite] = useState<string | null>(null);
  const clearInvite = useCallback(() => setInvite(null), []);

  useEffect(() => initDeepLinks(setInvite), []);

  if (!supabaseConfigured)
    return (
      <div className="splash">
        <div className="card">
          <b>Supabase isn't configured</b>
          <p className="note">Copy <code>app/.env.example</code> to <code>app/.env</code> and fill in the project URL and publishable key.</p>
        </div>
      </div>
    );
  if (session === undefined) return null;
  if (!session)
    return (
      <div className="splash">
        <MapView interactive={false} />
        <SignIn />
      </div>
    );
  return <Main me={session.user.id} now={now} invite={invite} clearInvite={clearInvite} />;
}

function Main({ me, now, invite, clearInvite }: { me: string; now: number; invite: string | null; clearInvite: () => void }) {
  const data = useLiveData(me);
  const [tab, setTab] = useState<Tab>("people");
  const [selected, setSelected] = useState<string | null>(null);
  const [detent, setDetent] = useState<Detent>("mid");
  const [sheetPx, setSheetPx] = useState(0);
  const [recenter, setRecenter] = useState(0);

  const rounds = useMemo(() => visibleRounds(data.rounds, now), [data.rounds, now]);
  const live = data.rounds.find((r) => r.user_id === me && r.status === "live");
  const incoming = data.friendships.filter((f) => f.status === "pending" && f.friend_id === me).length;
  const sel = selected ? rounds.find((r) => r.id === selected) : undefined;

  useEffect(() => {
    if (invite) (setTab("me"), setDetent("full"));
  }, [invite]);
  useEffect(() => {
    if (selected && !sel) setSelected(null); // their round ended or dropped off
  }, [selected, sel]);

  const pins: MapPin[] = useMemo(
    () =>
      rounds.flatMap((r) => {
        const info = roundInfo(r, data.courses.get(r.course_id), now);
        const pos = info && roundPosition(r, info.seq, info.est, now);
        if (!info || !pos) return [];
        const name = data.profiles.get(r.user_id)?.display_name || "Golfer";
        return [{ id: r.id, lat: pos[0], lng: pos[1], name, me: r.user_id === me, selected: r.id === selected,
          badge: info.est.phase === "live" ? String(r.hole) : undefined }];
      }),
    [rounds, data.courses, data.profiles, now, me, selected],
  );

  // The course on the map: whoever's selected, else your own live round on the Round tab.
  const focusRound = sel ?? (tab === "round" ? live : undefined);
  const course: CourseOverlay | null = useMemo(() => {
    const info = focusRound && roundInfo(focusRound, data.courses.get(focusRound.course_id), now);
    return info ? { seq: info.seq, current: focusRound!.status === "live" ? focusRound!.hole : 0, finished: focusRound!.status !== "live" } : null;
  }, [focusRound, data.courses, now]);

  const focus: MapFocus = (() => {
    const key = `${tab}|${focusRound?.id ?? ""}|${data.loaded}|${pins.length > 0}|${course ? 1 : 0}|${recenter}`;
    // Live: frame the hole they're on. Otherwise the whole course.
    if (course) return { key, bounds: courseBounds(course.current ? [course.seq[course.current - 1]] : course.seq) };
    if (pins.length === 1) return { key, center: [pins[0].lng, pins[0].lat], zoom: 15 };
    if (pins.length) {
      const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng);
      return { key, bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]] };
    }
    return { key };
  })();

  function openRound(id: string) {
    setSelected(id);
    setTab("people");
    setDetent("mid");
  }
  function go(t: Tab) {
    setTab(t);
    setSelected(null);
    if (t !== "people" && detent === "peek") setDetent("mid");
  }

  const title = sel
    ? sel.user_id === me ? "Your round" : data.profiles.get(sel.user_id)?.display_name || "Golfer"
    : tab === "people" ? "People" : tab === "round" ? (live ? "My Round" : "Start a Round") : "Me";

  const header = (
    <div className="sheet-head">
      {sel && (
        <button className="icon-btn" aria-label="Back to people" onClick={() => setSelected(null)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m15 6-6 6 6 6" /></svg>
        </button>
      )}
      <h2>{title}</h2>
      {tab === "people" && !sel && (
        <button className="icon-btn" aria-label="Add a friend" onClick={() => (go("me"), setDetent("full"))}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}
    </div>
  );

  return (
    <div className="app">
      <MapView pins={pins} course={course} focus={focus} bottomPad={sheetPx} onPin={openRound} />
      <button className="map-locate" aria-label="Show everyone" style={{ bottom: sheetPx + 14 }} onClick={() => (setSelected(null), setRecenter((n) => n + 1))}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20.5 3.5 3.8 10.6c-.9.4-.8 1.7.2 1.9l6.6 1.2 1.3 6.6c.2 1 1.5 1.1 1.9.2L20.5 3.5z" /></svg>
      </button>
      {live && <SharingPill roundId={live.id} hole={live.hole} reload={data.reload} />}
      {data.error && <p className="toast err" role="alert">Couldn't refresh: {data.error}</p>}

      <Sheet detent={detent} onDetent={setDetent} onHeight={setSheetPx} header={header} view={sel?.id ?? tab}>
        {sel ? (
          <RoundDetail round={sel} data={data} me={me} now={now} />
        ) : tab === "people" ? (
          <People data={data} me={me} now={now} rounds={rounds} onOpen={openRound} onAddFriends={() => (go("me"), setDetent("full"))} />
        ) : tab === "round" ? (
          <MyRound data={data} me={me} now={now} />
        ) : (
          <Me data={data} me={me} incomingCode={invite} onCodeUsed={clearInvite} />
        )}
      </Sheet>

      <nav className="tabbar" role="tablist">
        <TabButton id="people" tab={tab} go={go} label="People" badge={incoming}>
          <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.5 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 19.5C2 16 5 14 8.5 14s6.5 2 6.5 5.5V20H2v-.5zm14.5.5v-.5c0-1.9-.7-3.5-1.9-4.6.4-.1.9-.1 1.4-.1 3 0 6 1.7 6 4.7v.5h-5.5z" />
        </TabButton>
        <TabButton id="round" tab={tab} go={go} label={live ? `Hole ${live.hole}` : "Round"}>
          <path d="M6 2.5a1 1 0 0 1 1.5-.9l9 5a1 1 0 0 1 0 1.8L8 12.9V21a1 1 0 1 1-2 0V2.5z" />
        </TabButton>
        <TabButton id="me" tab={tab} go={go} label="Me">
          <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 8.5C4 16.9 7.6 14.5 12 14.5s8 2.4 8 6V21H4v-.5z" />
        </TabButton>
      </nav>
    </div>
  );
}

function TabButton({ id, tab, go, label, badge, children }: {
  id: Tab; tab: Tab; go: (t: Tab) => void; label: string; badge?: number; children: React.ReactNode;
}) {
  return (
    <button role="tab" aria-selected={tab === id} onClick={() => go(id)}>
      <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden>{children}</svg>
      <span>{label}</span>
      {badge ? <i className="tab-badge">{badge}</i> : null}
    </button>
  );
}

/** Always visible while sharing (HANDOFF §6), with a one-tap Stop. */
function SharingPill({ roundId, hole, reload }: { roundId: string; hole: number; reload: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const { busy, err, run } = useAction(reload);
  return (
    <div className="sharing" role="status">
      <div className="sharing-row">
        <span><i className="dot" aria-hidden /> Sharing live · Hole {hole}</span>
        <button className="btn small" onClick={() => setConfirm(!confirm)}>Stop</button>
      </div>
      {confirm && <StopConfirm busy={busy} onYes={() => run(() => endRound(roundId, "cancelled"))} onNo={() => setConfirm(false)} />}
      {err && <p className="note err">{err}</p>}
    </div>
  );
}
