# FairWhere v1.0 — launch goal

**Finish line:** a polished FairWhere 1.0 build is uploaded to App Store Connect, the listing is complete,
and the only thing left is **Sunny pressing "Submit for Review"**.
Decided 2026-10-07: **iPhone only · free · rounds-only location**.

Progress evidence goes in `docs/LAUNCH_AUDIT.md`: one row per item below, with status, PR link and proof
(command output, screenshot path, simulator recording). Update it as items land.

## How to work
- Run from a **local Mac session**. It needs Xcode, the iOS Simulator, and network access to Supabase and Apple.
  (Cloud sessions can't reach `*.supabase.co`.)
- Follow `CLAUDE.md`: a `claude/*` branch per workstream, small PRs into `main`, merge when green.
  Every schema change ships with RLS tests; `npm test`, `npm run typecheck`, `scripts/test-db.sh` pass before every push.
- **No new features** beyond this list. When something tempting comes up, add it to `docs/LATER.md`.
- Hidden v1 features are **flagged off, not deleted**.
- **Sunny-only steps:** ask once, clearly, with exact clicks. Keep working on everything else meanwhile.
  A Sunny-only blocker is a pause, never a reason to give up.

## 0. Land the open work
- [x] Review, fix and merge PR #4 (rename, alerts, everyday sharing, QR invites, course search), PR #5 (SoCal courses) and PR #6 (design references).
- [x] PR #5 deletes ~73k lines of `data/courses.json`: confirm that's intended (data moved to the region import), and that Redhawk + Temecula Creek Inn still seed and play correctly.
- [x] Every migration is applied to the hosted project (`uvyeenrkkvvsizszdizv`) and `supabase migration list` shows no drift.
- [ ] `NEXT_STEPS.md` and `README.md` describe FairWhere as it actually is.

Done 2026-10-07: #4, #5, #6, #7 squash-merged. #5's ~73k deleted lines are only `courses.json` going from
indented to one-course-per-line (Redhawk + Temecula Creek data verified identical); 47 likely-private
courses were dropped first, leaving 195 SoCal courses + the 2 originals. Both seeds applied live; local and
remote migration lists match through `20261005000002`.

## 1. v1 scope: flags
- [x] `app/src/lib/features.ts` holds the flags `game`, `everydayLocation` and `mapTools`, all `false` for v1, with tests.
- [x] None of the three has an entry point in the UI when off; no dead buttons or empty screens.
- [x] No permission prompts or Info.plist strings for hidden features. Location is **When In Use only, never "Always"**.

Done 2026-10-07 (PR "v1 scope: hide the game, everyday sharing and map tools"): `lib/features.ts` (all off, tested,
plus a test that Info.plist has no "Always" string while everyday sharing is off). Hidden: the Play-a-hole card and hole
picking on a buddy's round, the Challengers line and Hole game stat; the Location sharing section, sharing pill, spot
pins and spot lines, and the background sender; the map tools button. The game chunk (three.js, 560 KB) no longer
ships. `NSLocationAlwaysAndWhenInUseUsageDescription` removed; the privacy page no longer mentions the game.
Bring one back: flip its flag (everyday sharing also needs the "Always" string back in Info.plist).

## 2. Round location works with the phone in a pocket
- [x] Background location **during a live round only**: `@capacitor-community/background-geolocation` with the SaleMap patch-package fix, `UIBackgroundModes: location`, and the blue indicator. About 15 m distance filter, balanced accuracy.
- [x] Tracking stops on Finish, auto-finish (leaving the course), Stop sharing, and the 6h stale cutoff.
- [x] Writes stay throttled (hole change, else at most every 60–90 s).
- [x] Proof: a simulator run on a GPX route for a full Redhawk round, with the screen locked between holes. It auto-advances 1→18 and a second simulator (the friend) sees each hole live.
- [x] A field-test debug overlay (distance, candidate hole, fix count) exists behind a dev-only toggle.

Done 2026-10-07 (PR "Background GPS during a live round"):
- iPhone Simulator, full Redhawk route (70 waypoints, 8.4 km at 12 m/s). With the screen **locked**, the live
  `rounds` row (what friends' apps read over Realtime) advanced hole 10→18, each `hole_started_at` a few seconds after
  reaching the tee; `last_fix_at` only moved on hole changes (throttle holds). Permission prompt offered
  **While Using** only. After **Stop** (status `cancelled`), moving the simulated location showed no location arrow.
  The friend side was checked through those live rows rather than a second simulator signed in as a buddy.
- Finish / auto-finish / 6 h expiry stop tracking the same way Stop does (the round stops being live), but only Stop
  was exercised.
- Debug panel (tap "Hole" 5× within 2 s) is built but not yet seen on screen (the simulator's taps are too slow
  for the 2 s window). Check it on the real-phone field test.
- Still to do on a real iPhone: a real round at Redhawk with the phone in a pocket; battery use over 4 h.

## 3. Push notifications
- [x] A `device_tokens` table (RLS: owner only, with tests) and APNs registration via `@capacitor/push-notifications`, asked after a short in-app explanation and not at first launch.
- [x] Server sender: a Supabase Edge Function delivers `notifications` rows over APNs (the team's APNs `.p8` key) and stamps `pushed_at`. It is idempotent, and it never pushes alerts the watcher didn't ask for.
- [x] Tapping a push opens that friend's round.
- [x] Proof: an `xcrun simctl push` payload opens the right screen, plus an Edge Function test with a mocked APNs.

Done 2026-10-07 (PR "Push notifications for alerts"):
- Migration 15 (live): `device_tokens` + `register_device()` (owner-only, phone can move accounts), `claim_pushes()`
  (stamps `pushed_at` first: at most once; re-checks the watch), `push_feedback()`, and a pg_net nudge to the `push`
  function on every new alert plus a once-a-minute sweep. 16 new DB checks.
- `push` Edge Function deployed (no JWT; harmless to call). Shared alert text with the app
  (`supabase/functions/_shared/notes.ts`), times in the recipient's zone. 6 sender tests with a mocked APNs.
- iPhone Simulator: "Turn on notifications" (Edit profile, or the card in a buddy's alert settings) → iOS prompt →
  token saved with its zone; a payload built by the sender's own code showed as a banner, and tapping it opened that
  round from another tab.
- **Not yet end to end with Apple:** needs the APNs key set as Edge Function secrets (see NEXT_STEPS.md), then a real
  alert from a buddy's round.

## 4. Accounts, safety, App Review requirements
- [x] Native **Sign in with Apple** (team `8424XCN267`, bundle `com.sunnysimms.fairwhere`) plus the email/phone code. Google stays off unless Sunny asks.
- [x] **Delete account** in Me, as Apple guideline 5.1.1(v) requires. It removes the profile, rounds, scores, friendships, watches, notifications, tokens and the photo, with RLS-tested RPCs.
- [x] **Block** and **report** a user. Blocking hides both people from each other and cancels pending requests. Reports land in a table Sunny can check.
- [x] Privacy policy, terms and support pages hosted at a public URL and linked in the app.
- [x] OpenStreetMap attribution shown in About and on the map.

Done 2026-10-07 (PR "App Review requirements"):
- Migration 16 (live): `delete_my_account()` (cascades through every table; the app empties the photo folder first),
  `blocks` + `block_user()` / `my_blocks()` (you vanish for each other, alerts/shares/requests stop, request says "not
  found"), `reports` + `report_user()` (snapshot of who/why, optional block). 22 new DB checks.
- App: Report / Block at the bottom of a buddy's page and round; Blocked list in Edit profile; Delete account + About
  (Privacy · Terms · Support, credits) on Me; map credits as a top-left ⓘ (the sheet hid the old bottom one).
- Native Sign in with Apple: `AppleSignInPlugin.swift` (no client secret to renew), Apple provider on in Supabase with
  the bundle ID; Google button removed (it was never configured). Built, **not yet tried**: needs a real iPhone or a
  Simulator signed in to an Apple ID.
- Pages in `site/`, published by `.github/workflows/pages.yml` to https://mrjosephsimms.github.io/FairWhere/
  (privacy, terms with Apple's zero-tolerance / 24 h report language, support). Contact is **mrjosephsimms@gmail.com**
  for now (was support@fairwhere.app; switch back once the domain + email forwarding exist).
- Checked in the Simulator: Me page (Delete account, links, credits) and the map credits. Report/Block and the
  sign-in screen weren't seen on screen (that test account has no buddies; signing out would need your code).

## 5. Polish: it feels finished
- [x] First-run flow: name and photo → how location is used → notifications → add your first buddy (code, QR, invite link) → start a round. Every step can be skipped and resumed.
- [x] Every screen has deliberate empty, loading, error and offline states. No raw error strings, no layout jumps, no blank map.
- [x] Motion from `docs/DESIGN_REFERENCES.md`: hole change, a buddy going live, the sheet, the sharing pill, light haptics. All of it respects Reduce Motion.
- [ ] Accessibility: VoiceOver labels on every control and map pin, Dynamic Type up to XXL without clipping, AA contrast, 44 pt tap targets.
- [ ] Layout checked on iPhone SE (3rd gen), iPhone 17 and iPhone 17 Pro Max, with safe areas and the keyboard. Light-only design: system dark mode must not break anything.
- [ ] Performance on a device or simulator: cold start under 2 s to the map, smooth sheet and map drags, a 30-minute live round with no memory growth.
- [x] A `/interaction-audit` pass finds no dead or silently broken buttons.

Done 2026-10-07 (PR "Polish"):
- First run (`screens/Welcome.tsx`): you (photo, name, @username) → how location is used → notifications (only if
  not yet decided) → first buddy → start a round. Skippable at every step, resumes where you left off (checked by
  killing the app mid-way), shown only to new accounts (no username or no buddies).
- States: `lib/errors.ts` friendlyError everywhere (tested), offline banner + catch-up on reconnect, course list
  retry, errors shown next to what failed.
- Motion: new-hole pop, sharing chip/pill entrance, live buddies slide in, press feedback, walkthrough slide;
  haptics on hole change / score / round start & finish (`@capacitor/haptics`). Reduce Motion turns all of it off.
- Accessibility: colors adjusted to WCAG AA (4.5:1) on cards and background; iPhone text size followed via
  `@capacitor/text-zoom` (capped at 135%; checked at the largest size on Start a Round and Buddies); 44 pt touch
  areas on small controls; labels added where the audit found gaps.
- Audit (`/interaction-audit`-style pass): 18 findings, all fixed (alerts/scores save one at a time with real
  rollback, inbox rows always open something, remove-buddy/unblock/password "Not now" fixed, expired email link
  explained, same photo re-pickable, QR failure message).
- Layout: iPhone 17 (Simulator), iPhone SE size (375×667, browser), largest text size, dark mode (stays light,
  status bar readable).
- **Still open:** VoiceOver walk-through on a device, iPhone 17 Pro Max check, and the performance pass (cold start,
  30-minute round memory) — best done on your real iPhone.

## 6. Backend ready for real users
- [x] Every RLS test passes against a fresh database, and hosted policies match the migrations.
- [x] Cron jobs (stale rounds, alert jobs) are verified running on the hosted project.
- [x] Rate limits on friend requests, reports and sign-in codes.
- [x] Decision for Sunny: the free Supabase plan pauses projects after about a week of inactivity and has no daily backups. Recommend Pro ($25/mo) before launch.

Done 2026-10-07 (PR "Backend ready for real users"):
- Fresh database from the migrations: the whole RLS suite passes, and its 47 policies are **identical** to the live
  project's (`pg_policies` dumped from both and diffed). All 16 public tables have RLS on.
- Live cron: expire-stale-rounds (every 15 min), notify-tick and push-sweep (every minute) all running, 0 failures in
  the last hour. Added trim-job-logs (daily; pg_cron logged ~2,900 rows a day and never trimmed them).
- Limits (migration 17, live, tested): 20 friend requests an hour / 60 a day; 10 reports a day and one per person per
  day; profile photos 2 MB JPEG only. Sign-in: Supabase's per-IP limits pinned in config.toml (30 code requests and 30
  code checks per 5 min per IP); project-wide sign-in emails stay 30/hour on Gmail SMTP → switch to Resend before
  launch traffic.
- **Sunny decided: upgrade FairWhere's Supabase project to Pro ($25/mo) before launch** (dashboard → Billing; daily
  backups, no pausing).

## 7. App Store package
- [ ] App ID `com.sunnysimms.fairwhere` with Sign in with Apple and Push, an App Store Connect record "FairWhere", and version 1.0 build 1.
- [ ] App icon and launch screen. Claude proposes 2–3 options; Sunny picks.
- [ ] `PrivacyInfo.xcprivacy` privacy manifest, and drafted answers for the App Privacy "nutrition labels".
- [ ] Listing copy: name, subtitle, keywords, description and promo text, with category Sports (or Navigation).
- [ ] Screenshots for 6.9" and 6.5" iPhone from the simulator with polished demo data: a live buddy, a round, the scorecard, alerts.
- [ ] A review-notes demo account with buddies and a live demo round, so App Review can see live sharing without golfing.
- [ ] Archive and upload with the TestFlight recipe from SaleMap's `NOTES.md`. The build passes processing, and Sunny smoke-tests it from TestFlight on a real iPhone.

## 8. Done means
- [ ] `docs/LAUNCH_AUDIT.md` marks every item above done with evidence, or "Sunny-only" with the exact remaining step.
- [ ] `main` holds everything (no open launch PRs) and `git status` is clean.
- [ ] Final checks pass: `npm test`, `npm run typecheck`, `scripts/test-db.sh`, and a successful `xcodebuild` archive and upload.
- [ ] A short final report: what shipped, what's flagged off, and Sunny's remaining clicks to submit.

## Sunny-only (Claude prepares everything; Sunny clicks)
Domain for the privacy and support pages · Supabase plan · approving the app icon and screenshots ·
the real-iPhone TestFlight smoke test and the Redhawk field test · **Submit for Review**.
