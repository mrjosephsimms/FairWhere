Paste this into a new Claude Code session, with this folder in the repo:

---

I'm building **Tee Tracker**, a "Find My Friends for golf" mobile app. Friends see which hole I'm on, my tee time, and my estimated finish.

Read `HANDOFF.md` first. It has the scope, stack, data model, logic and milestones. Also:

- `data/courses.json`: hole centerlines and greens for my home courses, Redhawk and Temecula Creek Inn.
- `reference/pace.js` and `reference/holeDetect.js`: the tested finish-time and GPS hole-detection logic. Run `node reference/test.js`.
- `prototype/tee_tracker_artifact.html`: a working web prototype. Use it as a UI and logic reference only; don't port its `claude.use(...)` storage layer.

Start with **Milestone 1 and 2**:

1. Scaffold an Expo (React Native + TypeScript) app with Supabase auth and database. If my Yard Sale Club project uses a different stack, tell me and we'll match it.
2. Write the schema + RLS from HANDOFF §4.
3. Seed courses from `courses.json`.
4. Port the reference logic to TypeScript with tests.
5. Build Start Round → manual hole stepper → friends list with realtime ETA.

Ask me for any keys or accounts you need instead of guessing. Before writing code, give me a short plan and the list of accounts/env vars I need to create.
