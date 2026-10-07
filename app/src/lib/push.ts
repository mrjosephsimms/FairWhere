// iPhone push for alerts (docs/LAUNCH_GOAL.md step 3). iOS's permission prompt is only shown
// after our own one-line explanation, when someone first turns on alerts for a friend (never at
// first launch). The phone's APNs token goes to public.device_tokens via register_device(); the
// `push` Edge Function sends the alerts. While the app is open, the in-app banner shows alerts,
// so iOS banners are off in the foreground (capacitor.config.ts presentationOptions).
import { PushNotifications } from "@capacitor/push-notifications";
import { isNative } from "./native";
import { supabase } from "./supabase";

export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";
/** Where a tapped push should take you. */
export interface PushTarget {
  roundId?: string;
  golferId?: string;
}

const ASKED_KEY = "fairwhere.pushNotNow";
let token: string | null = null;

export async function pushPermission(): Promise<PushPermission> {
  if (!isNative) return "unsupported";
  const { receive } = await PushNotifications.checkPermissions();
  return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
}

/** Signed in: keep this phone registered and route push taps. Returns a cleanup. */
export function initPush(onOpen: (t: PushTarget) => void): () => void {
  if (!isNative) return () => {};
  const subs = [
    PushNotifications.addListener("registration", ({ value }) => {
      token = value;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      supabase.rpc("register_device", { p_token: value, p_tz: tz }).then(({ error }) => error && console.warn("register_device", error.message));
    }),
    PushNotifications.addListener("registrationError", (e) => console.warn("push registration failed", e.error)),
    PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const d = (notification.data ?? {}) as Record<string, string>;
      onOpen({ roundId: d.round_id, golferId: d.golfer_id });
    }),
  ];
  // Already allowed (an earlier launch): refresh the token quietly. Never prompts.
  pushPermission()
    .then((p) => {
      if (p === "granted") return PushNotifications.register();
    })
    .catch(() => {});
  return () => subs.forEach((s) => s.then((h) => h.remove()));
}

/** After the explanation: iOS's prompt, then register. */
export async function enablePush(): Promise<PushPermission> {
  if (!isNative) return "unsupported";
  const { receive } = await PushNotifications.requestPermissions();
  if (receive === "granted") await PushNotifications.register();
  return receive === "granted" ? "granted" : "denied";
}

/** "Not now" on the explanation: don't ask again on this phone (Edit alerts still offers it). */
export const pushDeclined = () => {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
};
export const declinePush = () => {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch { /* fine */ }
};

/** Signing out: this phone stops getting that account's alerts. */
export async function forgetThisPhone() {
  if (token) await supabase.from("device_tokens").delete().eq("token", token.toLowerCase());
}
