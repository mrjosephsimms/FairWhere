import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { passwordProblem, shouldAskForPassword } from "./password";

const user = (provider: string, meta: Record<string, unknown> = {}) =>
  ({ app_metadata: { provider }, user_metadata: meta }) as unknown as User;

describe("passwordProblem", () => {
  it("wants 8+ characters without edge spaces", () => {
    expect(passwordProblem("short")).toMatch(/8/);
    expect(passwordProblem(" padded pw ")).toMatch(/spaces/);
    expect(passwordProblem("fairway-18")).toBeNull();
  });
});

describe("shouldAskForPassword", () => {
  it("asks code sign-ins once", () => {
    expect(shouldAskForPassword(user("email"))).toBe(true);
    expect(shouldAskForPassword(user("phone"))).toBe(true);
    expect(shouldAskForPassword(user("email", { has_password: true }))).toBe(false);
    expect(shouldAskForPassword(user("email", { password_prompt_dismissed: true }))).toBe(false);
  });
  it("leaves Apple / Google sign-ins alone", () => {
    expect(shouldAskForPassword(user("apple"))).toBe(false);
    expect(shouldAskForPassword(user("google"))).toBe(false);
    expect(shouldAskForPassword(null)).toBe(false);
  });
});
