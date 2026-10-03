// Test-only access to the repo's course data.
import data from "../../../data/courses.json";
import type { CourseData, CourseFeatures } from "./courses";

export const courses = (data as unknown as { courses: CourseData[] }).courses;
export const course = (id: string) => courses.find((c) => c.id === id)!;
export const features = (id: string) => (course(id) as unknown as { features: CourseFeatures }).features;
