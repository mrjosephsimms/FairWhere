// Everyday location sharing, the sending side: while you're sharing with anyone, keep
// your position fresh (at most once a minute, or sooner if you've moved ~100 m).
// Web: only while the app is open. The iPhone app will keep it going in the
// background (needs iOS "Always" location, asked only when you turn sharing on).
import { useEffect } from "react";
import { saveMySpot } from "./db";
import { distM } from "./holeDetect";
import { watchLocation } from "./location";

const EVERY_MS = 60000, MOVED_M = 100;

export function usePresenceSharing(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let last: { lat: number; lng: number; t: number } | null = null;
    return watchLocation(
      ({ lat, lng, accuracy }) => {
        const t = Date.now();
        if (accuracy > 200) return;
        if (last && t - last.t < EVERY_MS && distM([last.lat, last.lng], [lat, lng]) < MOVED_M) return;
        last = { lat, lng, t };
        saveMySpot(lat, lng, accuracy).catch(() => (last = null)); // retry on the next fix
      },
      () => {},
    );
  }, [active]);
}
