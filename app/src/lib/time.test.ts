import { describe, expect, it } from "vitest";
import { fmtDur, nextTeeSlot, teeTimeFromInput, toTimeInput } from "./time";

const at = (h: number, m: number) => new Date(2026, 9, 3, h, m, 30);

describe("nextTeeSlot", () => {
  it("rounds to the next 8-minute slot at least 5 minutes out", () => {
    expect(toTimeInput(nextTeeSlot(at(9, 0)))).toBe("09:08");
    expect(toTimeInput(nextTeeSlot(at(9, 3)))).toBe("09:08");
    expect(toTimeInput(nextTeeSlot(at(9, 4)))).toBe("09:16");
    expect(toTimeInput(nextTeeSlot(at(9, 53)))).toBe("10:04"); // :64 rolls over
  });
});

describe("teeTimeFromInput", () => {
  it("keeps a normal time on today", () => {
    expect(teeTimeFromInput("07:30", at(9, 0)).getDate()).toBe(3);
  });
  it("reads a late-evening time entered after midnight as yesterday", () => {
    expect(teeTimeFromInput("23:50", at(0, 10)).getDate()).toBe(2);
  });
  it("reads an early tee time entered late at night as tomorrow", () => {
    expect(teeTimeFromInput("07:00", at(22, 0)).getDate()).toBe(4);
  });
});

describe("fmtDur", () => {
  it("formats minutes and hours", () => {
    expect(fmtDur(45 * 60000)).toBe("45 min");
    expect(fmtDur(105 * 60000)).toBe("1h 45m");
  });
});
