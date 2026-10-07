// Dynamic Type: iPhone's Settings › Display › Text Size (and Larger Text) scales the whole app.
// Capped so the biggest accessibility sizes stay readable without breaking the layout
// (layouts were checked up to this cap).
import { TextZoom } from "@capacitor/text-zoom";
import { isNative, onResume } from "./native";

export const MAX_TEXT_ZOOM = 1.35;

export function followTextSize(): () => void {
  if (!isNative) return () => {};
  const apply = () =>
    TextZoom.getPreferred()
      .then(({ value }) => TextZoom.set({ value: Math.min(Math.max(value, 0.85), MAX_TEXT_ZOOM) }))
      .catch(() => {});
  apply();
  return onResume(apply); // they may have changed it in Settings
}
