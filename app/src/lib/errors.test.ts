import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("passes our own plain-English messages through", () => {
    expect(friendlyError(new Error("No golfer has that code or username"))).toBe("No golfer has that code or username");
    expect(friendlyError(new Error("That's you"))).toBe("That's you");
  });
  it("hides database internals", () => {
    expect(friendlyError(new Error('duplicate key value violates unique constraint "friendships_pair_uniq"'))).toBe("Something went wrong. Please try again.");
    expect(friendlyError(new Error("permission denied for table rounds"), "Couldn't save that score.")).toBe("Couldn't save that score.");
    expect(friendlyError({ message: "JWT expired" })).toBe("You've been signed out. Sign in again.");
  });
  it("explains the common ones", () => {
    expect(friendlyError(new Error("TypeError: Failed to fetch"))).toMatch(/offline/);
    expect(friendlyError(new Error('duplicate key value violates unique constraint "profiles_username_key"'))).toBe("That username is taken. Try another.");
    expect(friendlyError(new Error("Email rate limit exceeded"))).toMatch(/Too many tries/);
    expect(friendlyError(new Error("Token has expired or is invalid"))).toMatch(/code has expired/);
  });
  it("falls back when there's nothing useful", () => {
    expect(friendlyError(null)).toBe("Something went wrong. Please try again.");
    expect(friendlyError(new Error(""))).toBe("Something went wrong. Please try again.");
  });
});
