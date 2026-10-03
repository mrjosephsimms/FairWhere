# Tee Tracker — Build Handoff

"Find My Friends" for golf. A golfer shares a live round; friends and family see **which hole they're on, when they teed off, and when they'll likely finish**, without texting "where are you?"

Owner: Sunny (Temecula, CA). Home courses: **Redhawk Golf Club** and **Temecula Creek Inn**.

---

## 1. What exists today

- **Working web prototype** (`prototype/tee_tracker_artifact.html`): a Claude-hosted page. Golfers start a round (course, nines, tee time, usual pace), then tap to advance holes. Followers see a live list with the current hole, an 18-cell scorecard strip, the estimated finish, ahead/behind pace, and a course map.
  - It uses Claude's page runtime (`claude.use("db")`, `claude.use("user")`) for storage and identity. **Don't port that layer.** Treat the file as a UI and logic reference only.
  - **Limitation:** the hosted page can't read GPS, so the hole is set manually. Fixing that is the main reason to build a native app.
- **Course data** (`data/courses.json`): pulled from OpenStreetMap (ODbL; attribution required in the app's About screen).
  - Redhawk: 18 holes. Temecula Creek Inn: 27 holes (Creek, Oaks and Stone House nines; a round is any two different nines).
  - Each hole has a tee→green centerline, yardage, par, and a green polygon where mapped.
  - `parInferred: true` means OSM had no par and it was guessed from length. **Verify against the real scorecards** (Redhawk 10–18 and all of Creek are inferred).
- **Reference logic** (`reference/`): pure JS, tested with `node reference/test.js`.
  - `pace.js`: finish-time estimate.
  - `holeDetect.js`: GPS fix → current hole, with debounce.
- **Course import** (`scripts/fetch_course.py "<course name>"`): adds any OSM-mapped course to `courses.json`. Overpass was unreachable from the build sandbox; the plain OSM map API + Nominatim work.

## 2. MVP scope (v1)

1. **Sign in.** Sign in with Apple, plus Google or phone OTP.
2. **Friends.** Add friends by invite link or contact. Mutual follow, like Find My. A share-link mode for non-users (e.g. a spouse) via a read-only web page is a strong v1.1.
3. **Start round.**
   - Pick a course. Default to the nearest course by GPS; for 27-hole courses, pick the nines.
   - Set the tee time (default: next 8-minute slot) and usual pace (3:45–4:45, default 4:15).
   - Choose who can see the round: all friends or selected.
4. **Live round.**
   - Auto-detect the hole from background GPS, with manual − / + override always available.
   - Show the big current hole, par/yards, estimated finish, ahead/behind chip, and course map with your dot.
5. **Friends view.** A list of live rounds showing name, course, hole N/18, scorecard strip, teed-off time, estimated finish, "~1h 45m left" and last-updated time. Tap a round for a map with their dot and the current hole highlighted.
6. **Finish / stop sharing.**
   - Auto-finish when on hole 18 and the golfer leaves the course polygon for 10+ min, or tap Finish.
   - Location sharing stops immediately on finish.
   - Round stays visible as "Finished 12:04" for 4 hours.
7. **Notifications (optional v1).** "Sunny made the turn: est. finish 12:10", and "Sunny finished."

**Out of scope for v1:** scoring/stats, rangefinder yardages, chat, tee-time booking.

## 3. Recommended stack

If Yard Sale Club already has a stack and accounts set up (Expo, Supabase, Firebase, etc.), **reuse it**. Otherwise:

- **App:** Expo (React Native + TypeScript), so one codebase covers iOS and Android.
- **Location:** `expo-location` + `expo-task-manager` for background location.
  - Only during an active round. Distance filter ~15 m, interval ~30 s, balanced accuracy.
  - On iOS, use "When In Use" plus a background location indicator. Avoid requesting "Always".
- **Map:** `react-native-maps`, satellite view, with hole centerlines and greens drawn as overlays.
- **Backend:** Supabase (Postgres + Auth + Realtime + RLS), or Firebase if preferred.
- **Web share page (v1.1):** a tiny Next.js or static page reading a share token.

## 4. Data model (Postgres / Supabase)

```
profiles(id uuid pk = auth.uid, display_name, avatar_url, created_at)
friendships(user_id, friend_id, status 'pending'|'accepted', created_at, pk(user_id, friend_id))
courses(id text pk, name, address, nines text[] null, data jsonb)   -- seeded from data/courses.json
rounds(
  id uuid pk, user_id fk, course_id fk,
  nines text[] null,                 -- e.g. {'Oaks','Creek'} for Temecula Creek Inn
  tee_time timestamptz, target_minutes int default 255,
  hole int default 1, hole_started_at timestamptz, hole_fraction real null,
  last_lat double, last_lng double, last_fix_at timestamptz,
  status text check (status in ('live','done','cancelled')),
  visibility text default 'friends', finished_at timestamptz, updated_at timestamptz
)
round_viewers(round_id, viewer_id)   -- only if visibility = 'selected'
share_links(token text pk, round_id, expires_at)  -- v1.1 web share
```

**Row-level security**

- Owners write their own rounds.
- Accepted friends (or listed viewers) can read `live`/recently `done` rounds.
- Nobody reads `last_lat`/`last_lng` once the round is done. Null them on finish.

**Realtime:** friends subscribe to `rounds` changes for their friend IDs.

**Write throttling:** write on hole change, otherwise at most once every 60–90 s. Don't write every GPS fix.

## 5. Core logic (port from `reference/`)

**Finish estimate** (`pace.js`)

- Split the target round time across holes by par weight (par 3 = 0.78, par 4 = 1.0, par 5 = 1.22).
- Expected minutes used so far = holes completed + progress on the current hole. Progress comes from GPS `frac`, or time on the hole capped at 90%.
- Pace factor = actual elapsed ÷ expected. Ignore it for the first 20 min; clamp it to 0.8–1.5.
- ETA = now + remaining expected × pace factor.
- Chip: within ±5 min = "On pace", otherwise "N min ahead/behind". Over 15 min behind shows red.
- **Compute on the viewer's device** from stored fields, so the ETA ticks without writes.

**Hole detection** (`holeDetect.js`)

- Distance from the fix to each centerline. Only consider holes current−2…current+2, so crossing an adjacent fairway doesn't jump the round.
- More than 120 m from all of them counts as off course: keep the current hole.
- Advance only after **2 consecutive fixes** on the same new hole. Never auto-move backward; the manual buttons cover that.
- **Ideas to improve:**
  - Use green polygons: inside the green, then the next tee, means the hole is complete.
  - Handle the tee box of hole N+1 sitting beside green N.
  - Treat a long stop near the clubhouse at the turn as part of the round, not off course.

**Play order:** Redhawk is holes 1–18. Temecula Creek Inn plays front nine `ref "<Nine> 1..9"` then back nine, numbered 10–18 in the app.

## 6. Privacy and app-store notes

- Location is shared **only during an active round**, and only with chosen people. Show an always-visible "Sharing live" banner with a Stop button.
- Auto-stop if the round has had no update for 6 hours.
- Write clear purpose strings: iOS `NSLocationWhenInUseUsageDescription`, and Android `ACCESS_BACKGROUND_LOCATION` with the Play Console declaration. The use case is "share live round progress with friends".
- Delete raw coordinates on finish. Keep only hole timestamps if stats are wanted later.

## 7. Milestones

1. Scaffold the app, auth, and seed `courses` from `courses.json`. Port `pace.js`/`holeDetect.js` to TS with the tests.
2. Start round → manual hole stepper → friends list with realtime ETA. This matches the prototype.
3. Background GPS + auto hole detection. Field test at Redhawk with the debug overlay showing distance, candidate hole and fix count.
4. Map view, finish/auto-stop, notifications.
5. Web share link for non-users. TestFlight / internal testing.

## 8. Open questions for Sunny

- Name: "Tee Tracker" is a placeholder.
- Friends only, or also a public "spectator link" for tournaments and events?
- Should the app show your score to friends (later), or stay strictly location and time?
