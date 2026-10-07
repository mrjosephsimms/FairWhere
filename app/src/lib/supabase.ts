import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url || "http://localhost:54321", key || "missing", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // PKCE so the native app can finish OAuth / magic links via deep link.
    flowType: "pkce",
  },
});

/** Whether the project has phone (text code) sign-in turned on, which needs an SMS provider. */
export async function phoneSignInEnabled(): Promise<boolean> {
  if (!url || !key) return false;
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    return Boolean((await r.json())?.external?.phone);
  } catch {
    return false;
  }
}
