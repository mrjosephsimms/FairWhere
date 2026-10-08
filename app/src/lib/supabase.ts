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

/** Which sign-in methods the project has switched on (phone needs an SMS provider, Google an OAuth client). */
export async function enabledProviders(): Promise<{ phone: boolean; google: boolean }> {
  if (!url || !key) return { phone: false, google: false };
  try {
    const ext = (await (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })).json())?.external ?? {};
    return { phone: Boolean(ext.phone), google: Boolean(ext.google) };
  } catch {
    return { phone: false, google: false };
  }
}
