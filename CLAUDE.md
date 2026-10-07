# Find My Golfer — Claude Code project rules

Live golf round sharing. **Start with `NEXT_STEPS.md`** (current state + pending setup). Spec: `docs/handoff/HANDOFF.md` (written as "Tee Tracker"; the product is now **Find My Golfer**). Setup + status: `README.md`.

## Separation
- Separate product from Yardsale Club (SaleMap) and from El Blunto: its own repo, own Supabase project, own bundle ID.
- Shared **accounts** are fine: Apple Developer team `8424XCN267`, Cloudflare, GitHub. Never point this app at SaleMap's Supabase project or API.

## Stack
- `app/`: Vite + React 19 + TS + Capacitor 8 (iOS via Swift Package Manager, no CocoaPods). Plain CSS tokens in `app/src/styles.css` (light + dark).
- `supabase/migrations/`: the whole backend. Schema, RLS, RPCs, cron. No server.
- **Launch goal**: `docs/LAUNCH_GOAL.md` (v1.0 scope + checklist); evidence in `docs/LAUNCH_AUDIT.md`.
- Design/animation inspiration: `docs/DESIGN_REFERENCES.md` (incl. https://prompt-motion.com/). Read it before UI or animation work.
- Pure logic lives in `app/src/lib/` (`pace.ts`, `holeDetect.ts`, `courses.ts`, `time.ts`) with vitest tests next to each file.

## Rules
- **Every schema/RLS change ships with a test in `supabase/tests/rls.sql`**; run `scripts/test-db.sh` before pushing.
- Run `npm test && npm run typecheck` in `app/` before pushing.
- ETA is computed on the **viewer's** device from stored fields. Don't add per-tick writes. Write on hole change, otherwise at most every 60–90s (HANDOFF §4).
- Location only during an active round. Never request iOS "Always" location; use When In Use + the background indicator (HANDOFF §6).
- `data/courses.json` is the source of course data. Regenerate the seed with `scripts/gen_course_seed.mjs` into a NEW migration once the previous one is applied.
- Milestone 3 (background GPS): Yardsale Club pins `@capacitor-community/background-geolocation@1.2.26` with a patch-package fix so it builds on Capacitor 8. Copy `frontend/patches/@capacitor-community+background-geolocation+1.2.26.patch` and the `postinstall` hook from the SaleMap repo.
- TestFlight: reuse the release recipe from SaleMap `NOTES.md` → "TestFlight pipeline" (temp keychain codesign workaround, no CLI signing overrides).

## Git
- Trunk is `main`. Work on a `claude/*` branch and land via PR.
