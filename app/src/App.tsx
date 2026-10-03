import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { initDeepLinks } from "./lib/native";
import { useAction, useLiveData, useNow, useSession } from "./lib/hooks";
import { endRound } from "./lib/db";
import { fmtTime } from "./lib/time";
import { StopConfirm } from "./components/RoundView";
import { SignIn } from "./screens/SignIn";
import { WhosOut } from "./screens/WhosOut";
import { MyRound } from "./screens/MyRound";
import { Friends } from "./screens/Friends";

type Tab = "out" | "mine" | "friends";

export default function App() {
  const session = useSession();
  const now = useNow();
  const [invite, setInvite] = useState<string | null>(null);

  const clearInvite = useCallback(() => setInvite(null), []);

  useEffect(() => initDeepLinks(setInvite), []);

  return (
    <div className="wrap">
      <header>
        <h1>Find My <span>Golfer</span></h1>
        <span className="sub">{fmtTime(now)}</span>
      </header>
      {!supabaseConfigured ? (
        <div className="card empty">
          <strong>Supabase isn't configured</strong>
          Copy <code>app/.env.example</code> to <code>app/.env</code> and fill in the project URL and publishable key.
        </div>
      ) : session === undefined ? null : session ? (
        <Main me={session.user.id} now={now} invite={invite} clearInvite={clearInvite} />
      ) : (
        <SignIn />
      )}
    </div>
  );
}

function Main({ me, now, invite, clearInvite }: { me: string; now: number; invite: string | null; clearInvite: () => void }) {
  const data = useLiveData(me);
  const [tab, setTab] = useState<Tab>("out");
  const live = data.rounds.find((r) => r.user_id === me && r.status === "live");
  const incoming = data.friendships.filter((f) => f.status === "pending" && f.friend_id === me).length;

  useEffect(() => {
    if (invite) setTab("friends");
  }, [invite]);

  const tabs: [Tab, string][] = [
    ["out", "Who's out"],
    ["mine", "My round"],
    ["friends", incoming ? `Friends (${incoming})` : "Friends"],
  ];

  return (
    <>
      {live && <SharingBanner roundId={live.id} hole={live.hole} reload={data.reload} />}
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {data.error && <p className="note err" role="alert">Couldn't refresh: {data.error}</p>}
      {tab === "out" && <WhosOut data={data} me={me} now={now} onAddFriends={() => setTab("friends")} />}
      {tab === "mine" && <MyRound data={data} me={me} now={now} />}
      {tab === "friends" && <Friends data={data} me={me} incomingCode={invite} onCodeUsed={clearInvite} />}
      <footer>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        <span>Course data © OpenStreetMap contributors (ODbL)</span>
      </footer>
    </>
  );
}

/** Always-visible while sharing (HANDOFF §6), with a one-tap Stop. */
function SharingBanner({ roundId, hole, reload }: { roundId: string; hole: number; reload: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const { busy, err, run } = useAction(reload);
  return (
    <div className="banner" role="status">
      <div className="row">
        <span><i className="dot" aria-hidden /> Sharing live · hole {hole}</span>
        <button className="btn small light" onClick={() => setConfirm(true)}>Stop</button>
      </div>
      {confirm && <StopConfirm busy={busy} onYes={() => run(() => endRound(roundId, "cancelled"))} onNo={() => setConfirm(false)} />}
      {err && <p className="note err">{err}</p>}
    </div>
  );
}
