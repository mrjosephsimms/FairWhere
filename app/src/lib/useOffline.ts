// True while the phone has no connection (browser online/offline events, which WKWebView fires too).
import { useEffect, useState } from "react";

export function useOffline(): boolean {
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => (window.removeEventListener("online", on), window.removeEventListener("offline", off));
  }, []);
  return offline;
}
