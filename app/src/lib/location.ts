// One place to watch the phone's position.
// - iPhone app: the background-geolocation plugin, so a live round keeps tracking with the
//   phone locked in a pocket (blue location indicator; "While Using" permission only, see
//   patches/@capacitor-community+background-geolocation+1.2.26.patch).
// - Web: navigator.geolocation (foreground only).
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface Fix {
  lat: number;
  lng: number;
  /** Metres. */
  accuracy: number;
  /** ms since epoch. */
  time: number;
}
export type LocationError = "denied" | "unavailable";

interface BgLocation { latitude: number; longitude: number; accuracy: number; time: number | null }
interface BgError { code?: string; message?: string }
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundTitle?: string;
      /** Setting this turns on background updates (and the blue indicator). */
      backgroundMessage?: string;
      requestPermissions?: boolean;
      /** Patched: ask for "Always" (only everyday sharing may; rounds never do). */
      requestAlways?: boolean;
      stale?: boolean;
      distanceFilter?: number;
      /** Patched: "balanced" = ~10 m accuracy, kinder to the battery. */
      accuracy?: "balanced";
      /** Patched: walking / cart, so iOS doesn't pause it. */
      activityType?: "fitness";
    },
    cb: (loc?: BgLocation, err?: BgError) => void,
  ): Promise<string>;
  removeWatcher(o: { id: string }): Promise<void>;
}
const Bg = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

/** Metres between updates while tracking a round. */
export const ROUND_DISTANCE_FILTER_M = 15;

/**
 * Watch position until the returned stop() is called. `background` keeps it running with the
 * screen locked (iPhone app only); use it for a live round and nothing else.
 */
export function watchLocation(
  onFix: (f: Fix) => void,
  onError: (e: LocationError) => void,
  { background = false }: { background?: boolean } = {},
): () => void {
  if (Capacitor.isNativePlatform()) {
    let id: string | null = null, stopped = false;
    Bg.addWatcher(
      {
        ...(background
          ? { backgroundTitle: "Sharing your round", backgroundMessage: "FairWhere is sharing which hole you're on." }
          : {}),
        requestPermissions: true,
        stale: false,
        distanceFilter: ROUND_DISTANCE_FILTER_M,
        accuracy: "balanced",
        activityType: "fitness",
      },
      (loc, err) => {
        if (err) return onError(err.code === "NOT_AUTHORIZED" ? "denied" : "unavailable");
        if (loc) onFix({ lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy, time: loc.time ?? Date.now() });
      },
    )
      .then((w) => {
        if (stopped) Bg.removeWatcher({ id: w }).catch(() => {}); // stopped before it started
        else id = w;
      })
      .catch(() => onError("unavailable"));
    return () => {
      stopped = true;
      if (id) Bg.removeWatcher({ id }).catch(() => {});
    };
  }

  if (!("geolocation" in navigator)) {
    onError("unavailable");
    return () => {};
  }
  const wid = navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, time: p.timestamp || Date.now() }),
    (e) => onError(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
  return () => navigator.geolocation.clearWatch(wid);
}
