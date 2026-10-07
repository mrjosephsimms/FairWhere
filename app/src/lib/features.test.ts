import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { features } from "./features";

describe("v1 feature flags", () => {
  it("ships with the game, everyday location sharing and map tools off", () => {
    expect(features).toEqual({ game: false, everydayLocation: false, mapTools: false });
  });
  it("asks iOS for While Using location only: no 'Always' purpose string while everyday sharing is off", () => {
    const plist = readFileSync(new URL("../../ios/App/App/Info.plist", import.meta.url), "utf8");
    expect(plist).toContain("NSLocationWhenInUseUsageDescription");
    if (!features.everydayLocation) expect(plist).not.toMatch(/NSLocationAlways/);
  });
});
