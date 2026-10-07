import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // allowedHosts: the Mac's Tailscale HTTPS name (tailscale serve), so phones get a secure page
  // (needed for GPS, the share sheet and the camera).
  server: { port: 5180, strictPort: true, allowedHosts: [".ts.net"], fs: { allow: [".."] } },
  test: { environment: "node" },
});
