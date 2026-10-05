import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { supabaseConfigured } from "./lib/supabase";
import { initDeepLinks } from "./lib/native";
import { useAction, useLiveData, useNow, useSession } from "./lib/hooks";
import { endRound } from "./lib/db";
import { roundInfo, visibleRounds } from "./lib/roundInfo";
import { courseBounds, roundPosition } from "./lib/geo";
import { playSequence } from "./lib/courses";
import { useRoundTracker } from "./lib/tracker";
import { usePresenceSharing } from "./lib/presence";
import { StopConfirm } from "./components/RoundView";
import { MapView, type CourseOverlay, type MapFocus, type MapPin } from "./components/MapView";
import { Sheet, type Detent } from "./components/Sheet";
import { SignIn } from "./screens/SignIn";
import { People, RoundDetail } from "./screens/People";
import { MyRound } from "./screens/MyRound";
import { Me } from "./screens/Me";
import { AddPeople } from "./screens/AddPeople";
import { AlertSettings, Inbox, NoteBanner, PersonCard } from "./screens/Alerts";

type Tab = "people" | "round" | "me";

// The 3D hole game (three.js) only downloads when someone taps Play.
const HoleGame = lazy(() => import("./game3d/HoleGame"));
// Dev-only playground (?demo=game&hole=N); import.meta.env.DEV strips it from builds.
const Demo = import.meta.env.DEV ? lazy(() => import("./game3d/Demo")) : null;

export default function App() {
  const session = useSession();
  const now = useNow();
  const [invite, setInvite] = useState<string | null>(null);
  const clearInvite = useCallback(() => setInvite(null), []);

  useEffect(() => initDeepLinks(setInvite), []);

  if (Demo && new URLSearchParams(location.search).get("demo") === "game")
    return <Suspense fallback={<div className="hg-loading">Loading the course…</div>}><Demo /></Suspense>;

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
  const [game, setGame] = useState<number | null>(null); // hole being played on the selected round
  const [adding, setAdding] = useState(false); // the "Add people" sheet (the + on People)
  const [search, setSearch] = useState<string | null>(null); // People search box (null = closed)
  const [person, setPerson] = useState<string | null>(null); // a friend's page when they aren't playing
  const [alertsFor, setAlertsFor] = useState<string | null>(null); // the bell: alert settings for this friend
  const [inbox, setInbox] = useState(false); // your alerts list

  const rounds = useMemo(() => visibleRounds(data.rounds, now), [data.rounds, now]);
  const live = data.rounds.find((r) => r.user_id === me && r.status === "live");
  const incoming = data.friendships.filter((f) => f.status === "pending" && f.friend_id === me).length;
  const sel = selected ? rounds.find((r) => r.id === selected) : undefined;

  // Live GPS for your own round. The course object is cached in db.ts, so `seq` stays
  // stable across refreshes and the location watch isn't restarted.
  const liveCourse = live ? data.courses.get(live.course_id) : undefined;
  const liveNines = live?.nines?.join("|");
  const liveSeq = useMemo(() => {
    try {
      return liveCourse ? playSequence(liveCourse, liveNines ? liveNines.split("|") : null) : undefined;
    } catch {
      return undefined;
    }
  }, [liveCourse, liveNines]);
  const sharingWith = data.shares.filter((s) => s.owner_id === me);
  usePresenceSharing(sharingWith.length > 0);
  const [notice, setNotice] = useState<string | null>(null);
  const gps = useRoundTracker(live, liveSeq, () => {
    setNotice("Looks like you left the course, so we finished your round and stopped sharing.");
    data.reload();
  });
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (invite) (setTab("people"), setSelected(null), setAdding(true), setDetent("full"));
  }, [invite]);
  useEffect(() => {
    if (selected && !sel) (setSelected(null), setGame(null)); // their round ended or dropped off
  }, [selected, sel]);
  // Stable while playing: only the (cached) course object and the hole number feed it,
  // so data refreshes and the clock don't reset a game mid-hole.
  const selCourse = sel ? data.courses.get(sel.course_id) : undefined;
  const selNines = sel?.nines?.join("|");
  const gameHole = useMemo(() => {
    if (!game || !selCourse) return undefined;
    try {
      return playSequence(selCourse, selNines ? selNines.split("|") : null)[game - 1];
    } catch {
      return undefined;
    }
  }, [game, selCourse, selNines]);

  const pins: MapPin[] = useMemo(
    () =>
      rounds.flatMap((r) => {
        const info = roundInfo(r, data.courses.get(r.course_id), now);
        // Your own pin follows this phone's GPS directly, without waiting for a write.
        const pos = r.id === live?.id && gps.fix ? gps.fix.pt : info && roundPosition(r, info.seq, info.est, now);
        if (!info || !pos) return [];
        const name = data.profiles.get(r.user_id)?.display_name || "Golfer";
        return [{ id: r.id, lat: pos[0], lng: pos[1], name, photo: data.profiles.get(r.user_id)?.avatar_url, me: r.user_id === me, selected: r.id === selected,
          badge: info.est.phase === "live" ? String(r.hole) : undefined }];
      }),
    [rounds, data.courses, data.profiles, now, me, selected, live?.id, gps.fix],
  );
  // Friends sharing their everyday location with you (unless they're on the course, where their round pin shows).
  const spotPins: MapPin[] = useMemo(
    () =>
      data.spots
        .filter((s) => s.user_id !== me && !rounds.some((r) => r.user_id === s.user_id && r.status === "live"))
        .map((s) => ({ id: `spot-${s.user_id}`, lat: s.lat, lng: s.lng, name: data.profiles.get(s.user_id)?.display_name || "Golfer",
          photo: data.profiles.get(s.user_id)?.avatar_url, selected: person === s.user_id })),
    [data.spots, data.profiles, rounds, me, person],
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
    if (course) {
      const on = course.seq.find((h) => h.n === course.current); // by number: a game overlay holds just one hole
      return { key, bounds: courseBounds(on ? [on] : course.seq) };
    }
    const spot = person ? data.spots.find((s) => s.user_id === person) : undefined;
    if (spot) return { key: `${key}|spot-${person}`, center: [spot.lng, spot.lat], zoom: 15 };
    if (pins.length === 1) return { key, center: [pins[0].lng, pins[0].lat], zoom: 15 };
    if (pins.length) {
      const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng);
      return { key, bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]] };
    }
    return { key };
  })();

  /** Leave any sub-page (round, person, alerts, inbox, add people). */
  function closePages() {
    setSelected(null);
    setGame(null);
    setAdding(false);
    setPerson(null);
    setAlertsFor(null);
    setInbox(false);
  }
  function openRound(id: string) {
    closePages();
    setSelected(id);
    setTab("people");
    setDetent("mid");
  }
  function go(t: Tab) {
    setTab(t);
    closePages();
    if (t !== "people" && detent === "peek") setDetent("mid");
  }

  const openAdding = () => (closePages(), setAdding(true), setDetent("full"));
  const openPerson = (id: string) => (closePages(), setPerson(id), setDetent("mid"));
  const openInbox = () => (closePages(), setInbox(true), setDetent("full"));
  // Whose page we're on (for the bell): a friend's round, or a friend who isn't playing.
  const pageOf = sel && sel.user_id !== me ? sel.user_id : person;
  const watching = (id: string | null) => !!id && data.watches.some((w) => w.watcher_id === me && w.golfer_id === id);
  const unread = data.notes.filter((n) => !n.read_at).length;
  const title = alertsFor
    ? `Alerts · ${data.profiles.get(alertsFor)?.display_name || "Golfer"}`
    : inbox
    ? "Notifications"
    : person
    ? data.profiles.get(person)?.display_name || "Golfer"
    : adding
    ? "Add people"
    : sel
    ? sel.user_id === me ? "Your round" : data.profiles.get(sel.user_id)?.display_name || "Golfer"
    : tab === "people" ? "People" : tab === "round" ? (live ? "My Round" : "Start a Round") : "Profile";

  const header = (
    <div className="sheet-head">
      {(sel || adding || person || inbox || alertsFor) && (
        <button className="icon-btn" aria-label="Back" onClick={() => (alertsFor ? setAlertsFor(null) : closePages())}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m15 6-6 6 6 6" /></svg>
        </button>
      )}
      {tab === "people" && !sel && !adding && !person && !inbox && search !== null ? (
        <input className="search" autoFocus value={search} placeholder="Search name or @username" aria-label="Search people"
          onChange={(e) => setSearch(e.target.value)} />
      ) : (
        <h2>{title}</h2>
      )}
      {pageOf && !alertsFor && (
        <button className={`icon-btn${watching(pageOf) ? " on" : ""}`} aria-label="Alerts for this person" onClick={() => (setAlertsFor(pageOf), setDetent("full"))}>
          <BellIcon filled={watching(pageOf)} />
        </button>
      )}
      {tab === "people" && !sel && !adding && !person && !inbox && (
        <>
          <button className="icon-btn bell" aria-label={unread ? `${unread} new alerts` : "Notifications"} onClick={openInbox}>
            <BellIcon />
            {unread > 0 && <i className="dot-badge">{unread}</i>}
          </button>
          <button className="icon-btn" aria-label={search !== null ? "Close search" : "Search people"} onClick={() => setSearch(search !== null ? null : "")}>
            {search !== null ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6 6 18" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            )}
          </button>
          <button className="icon-btn" aria-label="Add people" onClick={openAdding}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="app">
      <MapView pins={[...pins, ...spotPins]} course={course} focus={focus} bottomPad={sheetPx}
        onPin={(id) => (id.startsWith("spot-") ? openPerson(id.slice(5)) : openRound(id))} />
      <button className="map-locate" aria-label="Show everyone" style={{ bottom: sheetPx + 14 }} onClick={() => (setSelected(null), setRecenter((n) => n + 1))}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20.5 3.5 3.8 10.6c-.9.4-.8 1.7.2 1.9l6.6 1.2 1.3 6.6c.2 1 1.5 1.1 1.9.2L20.5 3.5z" /></svg>
      </button>
      {live && <SharingPill roundId={live.id} hole={live.hole} reload={data.reload} />}
      {!live && sharingWith.length > 0 && (
        <button className="loc-pill" onClick={() => go("me")}>
          📍 Sharing location with {sharingWith.length === 1 ? data.profiles.get(sharingWith[0].viewer_id)?.display_name || "1 person" : `${sharingWith.length} people`}
        </button>
      )}
      {data.error && <p className="toast err" role="alert">Couldn't refresh: {data.error}</p>}
      {notice && <p className="toast" role="status" onClick={() => setNotice(null)}>{notice}</p>}
      <NoteBanner data={data} onOpen={(n) => (rounds.some((r) => r.id === n.round_id) ? openRound(n.round_id) : openInbox())} />

      <Sheet detent={detent} onDetent={setDetent} onHeight={setSheetPx} header={header}
        view={alertsFor ? `alerts-${alertsFor}` : inbox ? "inbox" : person ? `person-${person}` : adding ? "adding" : sel?.id ?? tab}>
        {alertsFor ? (
          <AlertSettings data={data} me={me} golferId={alertsFor} />
        ) : inbox ? (
          <Inbox data={data} onOpen={(id) => rounds.some((r) => r.id === id) && openRound(id)} />
        ) : person ? (
          <PersonCard data={data} me={me} id={person} onAlerts={() => (setAlertsFor(person), setDetent("full"))} />
        ) : adding ? (
          <AddPeople data={data} me={me} incomingCode={invite} onCodeUsed={clearInvite} />
        ) : sel ? (
          <RoundDetail round={sel} data={data} me={me} now={now} onPlay={setGame} />
        ) : tab === "people" ? (
          <People data={data} me={me} now={now} rounds={rounds} query={search ?? ""} onOpen={openRound} onPerson={openPerson} onAddPeople={openAdding} />
        ) : tab === "round" ? (
          <MyRound data={data} me={me} now={now} gps={gps} />
        ) : (
          <Me data={data} me={me} now={now} />
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

      {sel && gameHole && (
        <Suspense fallback={<div className="hg-loading">Loading the course…</div>}>
          <HoleGame
            roundId={sel.id}
            courseId={sel.course_id}
            hole={gameHole}
            me={me}
            owner={{
              id: sel.user_id,
              name: sel.user_id === me ? "You" : data.profiles.get(sel.user_id)?.display_name || "Golfer",
              score: data.scores.get(sel.id)?.get(gameHole.n),
            }}
            plays={data.plays}
            profiles={data.profiles}
            onSaved={data.reload}
            onClose={() => setGame(null)}
          />
        </Suspense>
      )}
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

function BellIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" fill="none" />
    </svg>
  );
}

