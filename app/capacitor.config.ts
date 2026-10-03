import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Placeholder bundle ID: confirm before registering the App ID with Apple (it can't be renamed after).
  appId: "com.sunnysimms.findmygolfer",
  appName: "Find My Golfer",
  webDir: "dist",
  // Mirror JS console output into the Xcode log so white screens are debuggable.
  loggingBehavior: "debug",
};

export default config;
