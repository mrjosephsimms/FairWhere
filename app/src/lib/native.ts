// Native (Capacitor) glue: OAuth + magic-link deep links, invite links, share sheet.
// Same pattern as Yardsale Club's lib/nativeAuth.ts:
//   1. Ask Supabase for the provider URL with redirectTo = our URL scheme.
//   2. Open it in the system browser sheet (Google refuses embedded WebViews).
//   3. Provider -> Supabase -> 302 to fairwhere://auth-callback?code=...
//      which reopens the app; we exchange the PKCE code for a session.
// The scheme is registered in ios/App/App/Info.plist (CFBundleURLTypes), and
// fairwhere://auth-callback must be on Supabase's Redirect URLs allowlist.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { supabase } from "./supabase";

export const isNative = Capacitor.isNativePlatform();
export const SCHEME = "fairwhere";
export const AUTH_REDIRECT = `${SCHEME}://auth-callback`;
/** Window event: an email sign-in link couldn't be used (expired / already used). */
export const AUTH_LINK_FAILED = "fairwhere:auth-link-failed";

/** Where email links and OAuth should land. */
export const authRedirect = () => (isNative ? AUTH_REDIRECT : window.location.origin + window.location.pathname);

// Native Sign in with Apple (ios/App/App/AppleSignInPlugin.swift): Apple's Face ID sheet gives an
// identity token, Supabase checks it (no browser, no client secret to renew).
const AppleSignIn = registerPlugin<{
  authorize(o: { nonce: string }): Promise<{ identityToken: string; givenName: string; familyName: string }>;
}>("AppleSignIn");

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** iPhone only. A cancelled sheet isn't an error. */
export async function signInWithApple(): Promise<{ error: { message: string } | null }> {
  // A one-time value tying Apple's token to this request: Apple gets its hash, Supabase the original.
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hashed = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce)));
  let r: { identityToken: string; givenName: string; familyName: string };
  try {
    r = await AppleSignIn.authorize({ nonce: hashed });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === "CANCELED" ? { error: null } : { error: { message: err.message || "Sign in with Apple didn't work" } };
  }
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: r.identityToken, nonce });
  if (error) return { error };
  // Apple only shares the name on the first sign-in: use it instead of the (often hidden) email.
  const name = [r.givenName, r.familyName].filter(Boolean).join(" ").trim();
  if (name && data.user) await supabase.from("profiles").update({ display_name: name.slice(0, 40) }).eq("id", data.user.id);
  return { error: null };
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
      const { error } = code ? await supabase.auth.exchangeCodeForSession(code) : { error: new Error("no code") };
      // An old or already-used email link: tell the sign-in screen (it offers the code instead).
      if (error) window.dispatchEvent(new CustomEvent(AUTH_LINK_FAILED));
    } finally {
      Browser.close().catch(() => {});
    }
  });
}

/**
 * Open the phone's share sheet (AirDrop, Messages, Mail, WhatsApp...). Browsers only
 * offer it on secure (https) pages; when it isn't available this returns "menu" and
 * the caller shows our own share menu (shareTargets) instead.
 */
export async function shareText(text: string, url?: string): Promise<"shared" | "menu"> {
  if (isNative || navigator.share) {
    try {
      if (isNative) await Share.share({ title: "FairWhere", text, url });
      else await navigator.share({ title: "FairWhere", text, url });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "shared"; // they closed the sheet
    }
  }
  return "menu";
}

/** The usual places to send something, for when the system share sheet isn't available. */
export function shareTargets(text: string, url?: string) {
  const full = url ? `${text} ${url}` : text, enc = encodeURIComponent(full);
  const android = /Android/i.test(navigator.userAgent);
  return [
    { id: "sms", label: "Messages", href: `sms:${android ? "?" : "&"}body=${enc}` },
    { id: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${enc}` },
    { id: "mail", label: "Mail", href: `mailto:?subject=${encodeURIComponent("Join me on FairWhere")}&body=${enc}` },
  ];
}

/** Copy, working on plain-http pages too. */
export async function copyToClipboard(text: string) {
  return copyText(text);
}

/** Clipboard API where allowed (https), else the old select-and-copy trick (works on http too). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const area = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
  area.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Invite someone new: your code plus a link that signs them up and adds you. */
export const inviteMessage = (code: string, name: string): [string, string] =>
  [`Join me on FairWhere${name ? ` (${name})` : ""} so you can see which hole I'm on. Sign up and add me with code ${code}:`, addLink(code)];
export const shareInvite = (code: string, name: string) => shareText(...inviteMessage(code, name));

/** Share your profile: your @username and the same add-me link. */
export const profileMessage = (code: string, name: string, username: string | null): [string, string] =>
  [`Find me on FairWhere: ${name}${username ? ` (@${username})` : ""}.`, addLink(username ? `@${username}` : code)];
export const shareProfile = (code: string, name: string, username: string | null) => shareText(...profileMessage(code, name, username));

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

/** Open a web page: Safari view in the iPhone app, a new tab on the web. */
export function openLink(url: string) {
  if (isNative) Browser.open({ url }).catch(() => window.open(url, "_blank"));
  else window.open(url, "_blank", "noopener");
}

/** Public pages (privacy, terms, support). Hosted from the repo's site/ folder (GitHub Pages) until fairwhere.app exists. */
export const SITE = "https://mrjosephsimms.github.io/FairWhere";
export const LINKS = { privacy: `${SITE}/privacy.html`, terms: `${SITE}/terms.html`, support: `${SITE}/support.html` };
