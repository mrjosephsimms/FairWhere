// Optional password, for people who signed up with an emailed or texted code and would
// rather not wait for a code next time. Asked once (Me tab), changeable in Edit profile.
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export const PASSWORD_MIN = 8;

/** Why a new password won't do, or null if it's fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters.`;
  if (/^\s|\s$/.test(pw)) return "No spaces at the start or end.";
  return null;
}

export const hasPassword = (u: User | null) => Boolean(u?.user_metadata?.has_password);

/** Ask once: code sign-ins (email / text) that haven't set a password or said "not now". */
export function shouldAskForPassword(u: User | null): boolean {
  if (!u || hasPassword(u) || u.user_metadata?.password_prompt_dismissed) return false;
  const provider = u.app_metadata?.provider;
  return provider === "email" || provider === "phone";
}

export const savePassword = (password: string) =>
  supabase.auth.updateUser({ password, data: { has_password: true } });

export const dismissPasswordPrompt = () =>
  supabase.auth.updateUser({ data: { password_prompt_dismissed: true } });

/** The signed-in user, kept fresh (updates after savePassword / dismiss). */
export function useAuthUser(): User | null {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return user;
}
