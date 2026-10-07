import { describe, expect, it } from "vitest";
import { prettyPhone, toE164 } from "./phone";

describe("toE164", () => {
  it("accepts US numbers typed any way", () => {
    expect(toE164("(951) 555-0123")).toBe("+19515550123");
    expect(toE164("951.555.0123")).toBe("+19515550123");
    expect(toE164("1 951 555 0123")).toBe("+19515550123");
    expect(toE164("+1 951 555 0123")).toBe("+19515550123");
  });
  it("keeps other countries with a + code", () => {
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects things that aren't phone numbers", () => {
    expect(toE164("555-0123")).toBeNull();
    expect(toE164("123 456 7890")).toBeNull();
    expect(toE164("")).toBeNull();
  });
  it("prints US numbers nicely", () => {
    expect(prettyPhone("+19515550123")).toBe("(951) 555-0123");
    expect(prettyPhone("+442079460958")).toBe("+442079460958");
  });
});
