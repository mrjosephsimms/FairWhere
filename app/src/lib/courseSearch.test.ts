import { describe, expect, it } from "vitest";
import { matchCourses } from "../components/CourseSearch";
import { courses } from "./fixtures";

describe("matchCourses", () => {
  it("matches the start of any word in the name or address", () => {
    expect(matchCourses(courses, "redha").map((c) => c.id)).toEqual(["redhawk"]);
    expect(matchCourses(courses, "red").map((c) => c.id)).toContain("redhawk"); // plus any other "Red..." course
    expect(matchCourses(courses, "temecula creek inn").map((c) => c.id)).toEqual(["temecula-creek-inn"]);
    expect(matchCourses(courses, "temecula creek").map((c) => c.id)).toContain("temecula-creek-inn"); // + Cross Creek (Temecula)
    expect(matchCourses(courses, "TEM").length).toBeGreaterThanOrEqual(1);
  });
  it("shows everything for an empty query and nothing for nonsense", () => {
    expect(matchCourses(courses, "  ")).toHaveLength(courses.length);
    expect(matchCourses(courses, "zzzz")).toHaveLength(0);
  });
});
