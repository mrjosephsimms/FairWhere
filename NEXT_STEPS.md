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
- Project: **FindMyGolfer** (the app is now named FairWhere), ref `uvyeenrkkvvsizszdizv`, URL `https://uvyeenrkkvvsizszdizv.supabase.co`,
  us-east-1, free plan. Separate from SaleMap's project, as intended. Repo is `supabase link`ed.
- [x] Migrations 01–03 applied with `supabase db push --linked`. Verified: 6 public tables all RLS-on,
      `courses` = 2 rows, cron `expire-stale-rounds` (*/15) active, `rounds` + `friendships` in `supabase_realtime`.
      (01 needed `pgcrypto` → `extensions` schema: hosted Supabase installs extensions there.)
- [x] Auth config pushed from `supabase/config.toml` (`supabase config push`): site URL `http://localhost:5180`,
      redirect URLs `fairwhere://auth-callback` + `http://localhost:5180` (+ `/**`), email OTP length 8 → 6.
- [x] `app/.env` written (URL + `sb_publishable_…` key; gitignored, local to this Mac).
- [x] Custom SMTP (Gmail app password, mrjosephsimms@gmail.com) set in the dashboard by Sunny; email rate limit 30/h.
- [x] Magic-link email with the 6-digit code pushed (`supabase/templates/magic_link.html`). Use the code when the
      email is opened on a different device than the one that asked for it (links only work in the same browser).
- [x] Phone testing: redirect allow-list includes the Mac's Tailscale URL `http://100.111.147.89:5180/**`.

## First real test (do this before any new features)
1. `cd app && npm install && npm run dev` → sign in by email on http://localhost:5180.
2. Sign in as a second user in a private window. Add each other by friend code.
3. User A starts a round and steps holes. User B's "Who's out" should update **without a refresh**
   (Realtime). If it doesn't, check that `rounds` and `friendships` are in Database → Publications →
   `supabase_realtime`.
4. Finish the round: B should see "Finished hh:mm"; A's `last_lat/last_lng` in the table must be null.
5. `npm run ios` → run in the iOS Simulator; test the email link (opens `fairwhere://auth-callback`).

## Open decisions for Sunny
- **Name decided 2026-10-04: FairWhere.** Bundle ID `com.sunnysimms.fairwhere`, URL scheme `fairwhere://`.
  To do (Sunny): buy fairwhere.app (+ fairwhere.golf), quick check at tmsearch.uspto.gov, and change the SMTP
  sender name in Supabase (Auth -> Emails -> SMTP) to "FairWhere". Then point `addLink()` at the live domain.
- Domain: fairwhere.app (to buy). Needed for https invite/QR links and the v1.1 web share link.
- Apple / Google sign-in: needs an App ID, Services ID and Sign in with Apple key on team `8424XCN267`,
  plus a Google OAuth client. Email sign-in works without them.
- Open product questions from `docs/handoff/HANDOFF.md` §8 (spectator links, showing scores).

## Southern California courses (PR "Southern California public courses (OSM)")
- 242 OSM-mapped public SoCal courses added to `data/courses.json` by `scripts/import_region.py`; seed in
  `supabase/migrations/20261005000001/2_seed_socal_courses.sql`. **Not applied to the live project yet.**
- Before applying: decide on the "unsure access" country clubs / military courses and rename the placeholder
  course/nine names listed in the PR. The course picker already loads only
  `id, name, address, nines` + a center point and fetches `data` on pick (PR #4).

## Google sign-in — built, switched off until a Google client exists

The "Continue with Google" button appears by itself (iPhone and web) once Supabase has Google on.
1. console.cloud.google.com → new project "FairWhere" → APIs & Services → OAuth consent screen: External,
   app name FairWhere, support email, logo (design/icon/fairwhere-icon-1024.png), privacy/terms URLs
   (mrjosephsimms.github.io/FairWhere/privacy.html, terms.html), scopes email + profile + openid. Publish it.
2. Credentials → Create OAuth client ID → **Web application**; Authorized redirect URI:
   `https://uvyeenrkkvvsizszdizv.supabase.co/auth/v1/callback`.
3. Supabase dashboard → Auth → Sign In / Providers → Google: enable, paste Client ID + Client Secret, save.
4. Before the next `supabase config push`, add `[auth.external.google] enabled = true`, `client_id = "<id>"`,
   `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"` to config.toml (with that env var set), or the push
   switches Google back off. The app's `fairwhere://auth-callback` redirect is already allowed.

## Phone sign-in (text a code) — built, switched off

The sign-in screen shows an Email | Phone toggle by itself once the Supabase project has
phone login on (it reads `/auth/v1/settings`). To turn it on:
1. Make a Twilio account, create a **Verify** service (or buy a number for plain Twilio SMS).
2. Supabase dashboard -> Auth -> Sign In / Providers -> Phone: enable, pick Twilio Verify,
   paste Account SID / Auth Token / Verify Service SID. Add test phone numbers + fixed codes
   there for App Review / dev (keep them OUT of config.toml — this repo is public).
3. Pin `[auth.sms] enable_signup = true` and `[auth.sms.twilio_verify] enabled = true`
   (secret via `env(...)`) in `supabase/config.toml` BEFORE the next `supabase config push`,
   or the push turns phone login back off.

## Push notifications — turn on delivery (one command)

Everything is built and live except Apple's key. APNs keys are per Apple team, so the Yard Sale Club key
(`AuthKey_C3GRBNTY2J.p8`, team `8424XCN267`) works for FairWhere too. With the `.p8` file's path:

    ~/bin/supabase secrets set APNS_KEY_ID=C3GRBNTY2J APNS_TEAM_ID=8424XCN267 APNS_KEY="$(cat /path/to/AuthKey_C3GRBNTY2J.p8)"

Until then the `push` function answers "APNs key not configured" and leaves alerts in the app only.
Before the first device build: Xcode → App target → Signing & Capabilities should show **Push Notifications**
(the entitlement is in `ios/App/App/App.entitlements`; automatic signing registers it on the App ID).

## Before App Review: Supabase Pro, sign-in email, support email + reports

- **Upgrade FairWhere's Supabase project to Pro** (decided 2026-10-07): dashboard → project uvyeenrkkvvsizszdizv →
  Billing. Daily backups, no pausing.
- **Sign-in emails** go through Gmail SMTP, capped at 30/hour project-wide (Gmail allows ~500/day). Move to Resend
  (as Yard Sale Club did) before launch, then raise `[auth.rate_limit] email_sent`.

- **support@fairwhere.app must work** (it's on the privacy/terms/support pages): buy fairwhere.app, then e.g.
  Cloudflare Email Routing → your Gmail. Then point the pages at the domain if you like (`site/`, `app/src/lib/native.ts` SITE).
- **Reports** (Apple expects action within 24 h): Supabase dashboard → SQL editor:
  `select * from reports where resolved_at is null order by created_at;` then
  `update reports set resolved_at = now() where id = '...';` (and block / delete the account if needed).

## Location (2026-10-04)
- Built: everyday location sharing (off by default, owner grants per person with an expiry), "not at a golf
  course" check on Start a Round, auto-finish when the golfer leaves the course (client 10 min / 3 km rule +
  server 2 km backup in notify_tick). Web sends everyday location only while the app is open.
- Native TODO: background location for everyday sharing needs the background-geolocation plugin + UIBackgroundModes
  `location` + requesting "Always" only when sharing is turned on (purpose string already in Info.plist).

## Then: Milestone 3 (background GPS)
- Port the patch-package fix for `@capacitor-community/background-geolocation@1.2.26` from the SaleMap
  repo (`frontend/patches/…` + `postinstall`); see CLAUDE.md.
- Wire `app/src/lib/holeDetect.ts` (`makeHoleTracker`) to location updates during a live round only.
  Write `hole`/`hole_fraction`/`last_*` on hole change, else at most every 60–90 s. Add a debug overlay
  (distance, candidate hole, fix count) for the Redhawk field test.

## Related: Yard Sale Club (SaleMap) stays live
- Decided 2026-10-04: Yard Sale Club is **not** being shelved. FairWhere launches as its own App Store app
  (own repo, Supabase project and bundle ID; shares only the Apple Developer team). Don't merge SaleMap's draft
  ARCHIVE.md PR (#70).
