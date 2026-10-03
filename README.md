# Find My Golfer

"Find My Friends" for golf. Share a live round and friends see **which hole you're on, when you teed off, and when you'll likely finish**, without texting "where are you?"

Owner: Sunny (Temecula, CA). Home courses: Redhawk Golf Club and Temecula Creek Inn.
Product spec: [`docs/handoff/HANDOFF.md`](docs/handoff/HANDOFF.md) (written under the working name "Tee Tracker").

## Stack

Matches Yardsale Club's app shell, minus its Python backend:

| Layer | Choice |
|---|---|
| App | Vite + React 19 + TypeScript, wrapped for iOS with **Capacitor 8** (`app/`, `app/ios/`) |
| Backend | **Supabase only**: Postgres + Auth + Realtime + RLS (`supabase/migrations/`). No server to run. |
| Maps | SVG course map drawn from OSM hole centerlines, so no tile provider or key is needed yet |
| Course data | OpenStreetMap (ODbL), `data/courses.json`, imported with `scripts/fetch_course.py` |

## Status

- ✅ **Milestone 1**: app scaffold, auth (Apple / Google / email link or code), schema + RLS, courses seeded, pace + hole-detection logic ported to TypeScript with tests.
- ✅ **Milestone 2**: Start Round (course, nines, tee time, pace, who can see it) → manual hole stepper → "Who's out" list with live ETA via Realtime; friends by code / invite link; finish, stop sharing, "Sharing live" banner.
- ⏳ **Milestone 3**: background GPS + auto hole detection (`app/src/lib/holeDetect.ts` is ready and tested).
- ⏳ Milestones 4–5: map polish, auto-finish, notifications, web share link, TestFlight.

## Setup (accounts + env vars)

1. **Supabase**: create a new project (e.g. `find-my-golfer`). Don't reuse SaleMap's project.
   - Apply the migrations, in order: `supabase db push --db-url "<connection string>"`, or paste each file from `supabase/migrations/` into the SQL editor.
   - **Auth → URL Configuration → Redirect URLs**: add `findmygolfer://auth-callback` and `http://localhost:5180`.
   - **Auth → Email Templates → Magic Link**: add `{{ .Token }}` so the email also carries a 6-digit code.
2. **`app/.env`** (copy `app/.env.example`):
   - `VITE_SUPABASE_URL`: Project Settings → API → Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Project Settings → API → publishable key
3. **Sign in with Apple** (Apple Developer team `8424XCN267`):
   - Register App ID `com.sunnysimms.findmygolfer` with Sign in with Apple. This bundle ID is a placeholder; change it in `app/capacitor.config.ts` and the Xcode project **before** registering, because it can't be renamed afterwards.
   - Create a Services ID and a Sign in with Apple key. Enable the Apple provider in Supabase with the client secret JWT. Same recipe as Yardsale Club's `NOTES.md` → "Sign in with Apple"; the secret expires every 6 months.
4. **Google sign-in** (optional): OAuth client in Google Cloud Console, then enable the Google provider in Supabase.

## Develop

```sh
cd app && npm install
npm run dev          # http://localhost:5180 (web works for everything except native deep links)
npm test             # pace / hole detection / course order / tee-time tests (vitest)
npm run typecheck
../scripts/test-db.sh   # applies all migrations to a throwaway Postgres and runs the RLS tests
npm run ios          # build + cap sync + open Xcode (Mac only)
```

Adding a course:

```sh
python3 scripts/fetch_course.py "Pala Mesa Resort golf"
node scripts/gen_course_seed.mjs supabase/migrations/<new timestamp>_seed_courses.sql
```

Verify the par of any hole marked `parInferred: true` against the real scorecard. Redhawk 10–18 and all of Creek are inferred.

## Privacy model (enforced in the database)

- A round is visible only to its owner and to **accepted** friends: while live (and updated in the last 6h), or for 4h after it finishes. "Selected" rounds are visible only to the listed friends.
- Coordinates are wiped the moment a round stops being live. A cron job closes rounds with no update for 6h.
- Friend requests go through RPCs. Nobody can insert or accept a friendship directly.
- `supabase/tests/rls.sql` covers each of these rules.

Course data © OpenStreetMap contributors, ODbL 1.0.
