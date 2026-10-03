// Native (Capacitor) glue: OAuth + magic-link deep links, invite links, share sheet.
// Same pattern as Yardsale Club's lib/nativeAuth.ts:
//   1. Ask Supabase for the provider URL with redirectTo = our URL scheme.
//   2. Open it in the system browser sheet (Google refuses embedded WebViews).
//   3. Provider -> Supabase -> 302 to findmygolfer://auth-callback?code=...
//      which reopens the app; we exchange the PKCE code for a session.
// The scheme is registered in ios/App/App/Info.plist (CFBundleURLTypes), and
// findmygolfer://auth-callback must be on Supabase's Redirect URLs allowlist.
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { supabase } from "./supabase";

export const isNative = Capacitor.isNativePlatform();
export const SCHEME = "findmygolfer";
export const AUTH_REDIRECT = `${SCHEME}://auth-callback`;

/** Where email links and OAuth should land. */
export const authRedirect = () => (isNative ? AUTH_REDIRECT : window.location.origin + window.location.pathname);

export async function signInWithProvider(provider: "apple" | "google") {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: authRedirect(), skipBrowserRedirect: isNative },
  });
  if (!error && isNative && data?.url) await Browser.open({ url: data.url, windowName: "_self" });
  return { error };
}

/** Invite link a friend can tap; also accepted as a plain code. */
export const inviteLink = (code: string) => `${SCHEME}://add/${code}`;

/** Pull a friend code out of an invite link (findmygolfer://add/ABC234). */
export function codeFromUrl(url: string): string | null {
  const m = url.match(/^findmygolfer:\/\/add\/([A-Za-z0-9]{6})\b/);
  return m ? m[1].toUpperCase() : null;
}

/** Install deep-link handling once at startup. */
export function initDeepLinks(onInvite: (code: string) => void): void {
  if (!isNative) {
    const code = new URLSearchParams(window.location.search).get("add");
    if (code) onInvite(code.toUpperCase());
    return;
  }
  CapApp.addListener("appUrlOpen", async ({ url }) => {
    const invite = codeFromUrl(url);
    if (invite) return onInvite(invite);
    if (!url.startsWith(AUTH_REDIRECT)) return;
    try {
      const code = new URLSearchParams(url.split("?")[1] ?? "").get("code");
      if (code) await supabase.auth.exchangeCodeForSession(code);
    } finally {
      Browser.close().catch(() => {});
    }
  });
}

export async function shareInvite(code: string, name: string): Promise<"shared" | "copied"> {
  const text = `Follow my golf rounds on Find My Golfer${name ? ` (${name})` : ""}. Add me with code ${code} or tap ${inviteLink(code)}`;
  if (isNative || navigator.share) {
    try {
      if (isNative) await Share.share({ title: "Find My Golfer", text });
      else await navigator.share({ title: "Find My Golfer", text });
      return "shared";
    } catch {
      /* cancelled: fall through to copy */
    }
  }
  await navigator.clipboard?.writeText(text);
  return "copied";
}

/** Fire when the app comes back to the foreground (refetch stale lists). */
export function onResume(fn: () => void): () => void {
  const vis = () => document.visibilityState === "visible" && fn();
  document.addEventListener("visibilitychange", vis);
  const sub = isNative ? CapApp.addListener("resume", fn) : null;
  return () => {
    document.removeEventListener("visibilitychange", vis);
    sub?.then((h) => h.remove());
  };
}
