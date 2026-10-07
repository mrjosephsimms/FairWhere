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
- [ ] `app/src/lib/features.ts` holds the flags `game`, `everydayLocation` and `mapTools`, all `false` for v1, with tests.
- [ ] None of the three has an entry point in the UI when off; no dead buttons or empty screens.
- [ ] No permission prompts or Info.plist strings for hidden features. Location is **When In Use only, never "Always"**.

## 2. Round location works with the phone in a pocket
- [ ] Background location **during a live round only**: `@capacitor-community/background-geolocation` with the SaleMap patch-package fix, `UIBackgroundModes: location`, and the blue indicator. About 15 m distance filter, balanced accuracy.
- [ ] Tracking stops on Finish, auto-finish (leaving the course), Stop sharing, and the 6h stale cutoff.
- [ ] Writes stay throttled (hole change, else at most every 60–90 s).
- [ ] Proof: a simulator run on a GPX route for a full Redhawk round, with the screen locked between holes. It auto-advances 1→18 and a second simulator (the friend) sees each hole live.
- [ ] A field-test debug overlay (distance, candidate hole, fix count) exists behind a dev-only toggle.

## 3. Push notifications
- [ ] A `device_tokens` table (RLS: owner only, with tests) and APNs registration via `@capacitor/push-notifications`, asked after a short in-app explanation and not at first launch.
- [ ] Server sender: a Supabase Edge Function delivers `notifications` rows over APNs (the team's APNs `.p8` key) and stamps `pushed_at`. It is idempotent, and it never pushes alerts the watcher didn't ask for.
- [ ] Tapping a push opens that friend's round.
- [ ] Proof: an `xcrun simctl push` payload opens the right screen, plus an Edge Function test with a mocked APNs.

## 4. Accounts, safety, App Review requirements
- [ ] Native **Sign in with Apple** (team `8424XCN267`, bundle `com.sunnysimms.fairwhere`) plus the email/phone code. Google stays off unless Sunny asks.
- [ ] **Delete account** in Me, as Apple guideline 5.1.1(v) requires. It removes the profile, rounds, scores, friendships, watches, notifications, tokens and the photo, with RLS-tested RPCs.
- [ ] **Block** and **report** a user. Blocking hides both people from each other and cancels pending requests. Reports land in a table Sunny can check.
- [ ] Privacy policy, terms and support pages hosted at a public URL and linked in the app.
- [ ] OpenStreetMap attribution shown in About and on the map.

## 5. Polish: it feels finished
- [ ] First-run flow: name and photo → how location is used → notifications → add your first buddy (code, QR, invite link) → start a round. Every step can be skipped and resumed.
- [ ] Every screen has deliberate empty, loading, error and offline states. No raw error strings, no layout jumps, no blank map.
- [ ] Motion from `docs/DESIGN_REFERENCES.md`: hole change, a buddy going live, the sheet, the sharing pill, light haptics. All of it respects Reduce Motion.
- [ ] Accessibility: VoiceOver labels on every control and map pin, Dynamic Type up to XXL without clipping, AA contrast, 44 pt tap targets.
- [ ] Layout checked on iPhone SE (3rd gen), iPhone 17 and iPhone 17 Pro Max, with safe areas and the keyboard. Light-only design: system dark mode must not break anything.
- [ ] Performance on a device or simulator: cold start under 2 s to the map, smooth sheet and map drags, a 30-minute live round with no memory growth.
- [ ] A `/interaction-audit` pass finds no dead or silently broken buttons.

## 6. Backend ready for real users
- [ ] Every RLS test passes against a fresh database, and hosted policies match the migrations.
- [ ] Cron jobs (stale rounds, alert jobs) are verified running on the hosted project.
- [ ] Rate limits on friend requests, reports and sign-in codes.
- [ ] Decision for Sunny: the free Supabase plan pauses projects after about a week of inactivity and has no daily backups. Recommend Pro ($25/mo) before launch.

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
