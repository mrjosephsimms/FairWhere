// Native (Capacitor) glue: OAuth + magic-link deep links, invite links, share sheet.
// Same pattern as Yardsale Club's lib/nativeAuth.ts:
//   1. Ask Supabase for the provider URL with redirectTo = our URL scheme.
//   2. Open it in the system browser sheet (Google refuses embedded WebViews).
//   3. Provider -> Supabase -> 302 to fairwhere://auth-callback?code=...
//      which reopens the app; we exchange the PKCE code for a session.
// The scheme is registered in ios/App/App/Info.plist (CFBundleURLTypes), and
// fairwhere://auth-callback must be on Supabase's Redirect URLs allowlist.
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { supabase } from "./supabase";

export const isNative = Capacitor.isNativePlatform();
export const SCHEME = "fairwhere";
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

/**
 * A normal web link that adds you (and signs them up first if needed). This is what
 * goes in texts and the QR code, so any phone camera can open it. Until the app has
 * its own domain it points at wherever this copy is being served from.
 */
export const addLink = (code: string) => `${isNative ? "https://fairwhere.app" : window.location.origin}/?add=${encodeURIComponent(code)}`;

const PENDING_ADD = "fairwhere.pendingAdd";
/** Remember an ?add= code across sign-in (the magic link comes back without the query). */
export function takePendingAdd(): string | null {
  try {
    const code = localStorage.getItem(PENDING_ADD);
    localStorage.removeItem(PENDING_ADD);
    return code;
  } catch {
    return null;
  }
}

/** Pull a friend code or @username out of an invite link (fairwhere://add/ABC234, fairwhere://add/@sam). */
export function codeFromUrl(url: string): string | null {
  const m = url.match(/^fairwhere:\/\/add\/(@[a-z0-9_.]{3,20}|[A-Za-z0-9]{6})\b/i);
  return m ? (m[1].startsWith("@") ? m[1].toLowerCase() : m[1].toUpperCase()) : null;
}

/** Install deep-link handling once at startup. */
export function initDeepLinks(onInvite: (code: string) => void): void {
  if (!isNative) {
    const code = new URLSearchParams(window.location.search).get("add");
    if (code) {
      try {
        localStorage.setItem(PENDING_ADD, code); // survives the sign-in round trip
      } catch {
        /* private mode: still works if they're already signed in */
      }
      history.replaceState(null, "", window.location.pathname); // tidy the address bar
      onInvite(code);
    }
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

/** Open the phone's share sheet (text, WhatsApp, AirDrop...); copy to the clipboard if there isn't one. */
export async function shareText(text: string, url?: string): Promise<"shared" | "copied"> {
  if (isNative || navigator.share) {
    try {
      if (isNative) await Share.share({ title: "FairWhere", text, url });
      else await navigator.share({ title: "FairWhere", text, url });
      return "shared";
    } catch {
      /* cancelled: fall through to copy */
    }
  }
  await navigator.clipboard?.writeText(url ? `${text} ${url}` : text);
  return "copied";
}

/** Invite someone new: your code plus a link that signs them up and adds you. */
export function shareInvite(code: string, name: string) {
  return shareText(`Join me on FairWhere${name ? ` (${name})` : ""} so you can see which hole I'm on. Sign up and add me with code ${code}:`, addLink(code));
}

/** Share your profile: your @username and the same add-me link. */
export function shareProfile(code: string, name: string, username: string | null) {
  return shareText(`Find me on FairWhere: ${name}${username ? ` (@${username})` : ""}.`, addLink(username ? `@${username}` : code));
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
