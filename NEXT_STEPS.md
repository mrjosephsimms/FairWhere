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

## Supabase project — set up 2026-10-03 (local Mac session)
- Project: **FindMyGolfer**, ref `uvyeenrkkvvsizszdizv`, URL `https://uvyeenrkkvvsizszdizv.supabase.co`,
  us-east-1, free plan. Separate from SaleMap's project, as intended. Repo is `supabase link`ed.
- [x] Migrations 01–03 applied with `supabase db push --linked`. Verified: 6 public tables all RLS-on,
      `courses` = 2 rows, cron `expire-stale-rounds` (*/15) active, `rounds` + `friendships` in `supabase_realtime`.
      (01 needed `pgcrypto` → `extensions` schema: hosted Supabase installs extensions there.)
- [x] Auth config pushed from `supabase/config.toml` (`supabase config push`): site URL `http://localhost:5173`,
      redirect URLs `findmygolfer://auth-callback` + `http://localhost:5173`, email OTP length 8 → 6.
- [x] `app/.env` written (URL + `sb_publishable_…` key; gitignored, local to this Mac).
- [ ] **Magic-link email with the 6-digit code**: template is ready at `supabase/templates/magic_link.html`, but the
      free plan rejects template edits on Supabase's built-in mailer. Needs custom SMTP first (Auth → SMTP; e.g. a
      Resend account of its own + a sending domain), then uncomment the block in `config.toml` and `supabase config push`.
      Until then the stock email has only the link — sign in by tapping it.
- ⚠️ Built-in mailer limits: it only delivers to members of the Supabase org and is rate-limited (a few emails/hour).
  For the two-user test, sign in with addresses on the org (or invite the second address to the org) — or set up SMTP.

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
