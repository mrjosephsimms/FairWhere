# Next steps — handoff from the 2026-10-03 cloud session

Read this first, then `CLAUDE.md` and `README.md`. Delete or update this file as items land.

## Where things stand
- Repo created and pushed (`main`, first commit `3378f05`): Milestones 1 + 2 are built.
- Verified in the cloud session: `npm test` (27 tests), `npm run typecheck`, `vite build`,
  `scripts/test-db.sh` (all migrations + 55 RLS checks on a local Postgres, plus a deliberate
  broken-policy check that the tests caught), and a headless-browser walkthrough against a
  **mocked** Supabase (start round → step hole → friends tab; light + dark, no console errors).
- **Never run against the real Supabase project or on a device yet.** The cloud sandbox's
  network policy blocked `*.supabase.co`.

## Supabase project (created by Sunny, still empty)
- Project: **FindMyGolfer**, ref `uvyeenrkkvvsizszdizv`, URL `https://uvyeenrkkvvsizszdizv.supabase.co`,
  us-east-1, free plan. Separate from SaleMap's project, as intended.
- [ ] Apply migrations in order: `supabase/migrations/20261003000001_init.sql`, `…02_expire_stale_rounds.sql`,
      `…03_seed_courses.sql` (SQL editor, or `supabase db push --db-url "<direct connection string>"`).
      Then confirm in Table Editor: `courses` has 2 rows, and Database → Cron has `expire-stale-rounds`.
- [ ] Auth → URL Configuration → Redirect URLs: `findmygolfer://auth-callback` and `http://localhost:5173`.
- [ ] Auth → Emails → Magic Link template: add `{{ .Token }}` (the app accepts the link or the 6-digit code).
- [ ] Create `app/.env` from `app/.env.example` with the project URL and the `sb_publishable_…` key.

## First real test (do this before any new features)
1. `cd app && npm install && npm run dev` → sign in by email on http://localhost:5173.
2. Sign in as a second user in a private window. Add each other by friend code.
3. User A starts a round and steps holes. User B's "Who's out" should update **without a refresh**
   (Realtime). If it doesn't, check that `rounds` and `friendships` are in Database → Publications →
   `supabase_realtime`.
4. Finish the round: B should see "Finished hh:mm"; A's `last_lat/last_lng` in the table must be null.
5. `npm run ios` → run in the iOS Simulator; test the email link (opens `findmygolfer://auth-callback`).

## Open decisions for Sunny
- **Bundle ID**: `com.sunnysimms.findmygolfer` is a placeholder (`app/capacitor.config.ts` + Xcode project).
  It can't be renamed after the App ID is registered with Apple, so confirm it first.
- Domain: none yet. One would be needed for the v1.1 web share link and https invite links.
- Apple / Google sign-in: needs an App ID, Services ID and Sign in with Apple key on team `8424XCN267`,
  plus a Google OAuth client. Email sign-in works without them.
- Open product questions from `docs/handoff/HANDOFF.md` §8 (spectator links, showing scores).

## Then: Milestone 3 (background GPS)
- Port the patch-package fix for `@capacitor-community/background-geolocation@1.2.26` from the SaleMap
  repo (`frontend/patches/…` + `postinstall`); see CLAUDE.md.
- Wire `app/src/lib/holeDetect.ts` (`makeHoleTracker`) to location updates during a live round only.
  Write `hole`/`hole_fraction`/`last_*` on hole change, else at most every 60–90 s. Add a debug overlay
  (distance, candidate hole, fix count) for the Redhawk field test.

## Related: Yardsale Club (SaleMap) is being shelved
- Archive guide: SaleMap repo `ARCHIVE.md`, in draft PR https://github.com/mrjosephsimms/SaleMap/pull/70
  (not merged yet). After merging, create tag `archive/yardsale-club-2026-10-03` (commands in ARCHIVE.md).
- Still to do on the Mac mini: encrypted backup of the secrets (Apple `.p8` keys are the only copies),
  `pg_dump` of the SaleMap DB, then choose Mothball vs Cold storage.
  If it stays live: the Apple sign-in client secret in SaleMap's Supabase expires ~Dec 8 2026.
