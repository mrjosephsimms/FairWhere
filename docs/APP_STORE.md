# FairWhere: App Store Connect package (v1.0)

Everything to paste into App Store Connect. Drafted 2026-10-07; Sunny edits and approves.
Limits are Apple's (characters). Keep this file in sync with what's live in ASC.

## App record

| Field | Value |
|---|---|
| Name (30) | **FairWhere: Golf Round Tracker** (29) |
| Bundle ID | `com.sunnysimms.fairwhere` |
| SKU | `fairwhere-ios` |
| Primary language | English (U.S.) |
| Primary category | Sports |
| Secondary category | Navigation |
| Price | Free (no in-app purchases in v1.0) |
| Age rating | 4+ (see questionnaire below) |
| Seller | Sunny Simms Inc. (team 8424XCN267) |

## Listing

**Subtitle (30):** See which hole they're on (26)

**Promotional text (170):**
Golf day, minus the "where are you?" texts. Your buddies see the hole you're on and when you'll be done, live, while you play. (126)

**Description (4000):**

> FairWhere lets the people waiting on you follow your golf round live: which hole you're on and about when you'll be done. No more "where are you?" texts.
>
> START A ROUND, THEN FORGET ABOUT IT
> Pick your course, tee time and whether you're riding or walking. FairWhere works out which hole you're on from your phone's GPS and moves to the next hole when you reach the tee, even with your phone in your pocket.
>
> FOR THE PEOPLE AT HOME
> Your buddies see your hole, how far along it you are, and an estimated finish time that follows your real pace. Perfect for whoever's planning dinner, waiting at the turn, or picking you up.
>
> ALERTS YOU CHOOSE
> Tap the bell on a buddy's page for the alerts you want: when they tee off, every hole or just the ones you pick, a heads-up 15 to 60 minutes before they finish, when they're done (with their score), or when they might be hunting for a ball.
>
> KEEP SCORE AS YOU GO
> A simple scorecard, par to start, one tap for each stroke. Your buddies see the score if you keep one.
>
> YOUR LOCATION STAYS YOURS
> FairWhere only uses your location during a round you start, and stops when you finish, or by itself if you leave the course. Your buddies never see where you are otherwise. You choose who sees each round.
>
> 197 Southern California courses to start, with more on the way. Course maps © OpenStreetMap contributors.

**Keywords (100):** `golf,tracker,round,live,location,share,family,buddies,tee time,eta,pace,scorecard,friends,course` (97)

**Support URL:** https://mrjosephsimms.github.io/FairWhere/support.html
**Marketing URL:** https://mrjosephsimms.github.io/FairWhere/
**Privacy policy URL:** https://mrjosephsimms.github.io/FairWhere/privacy.html
**Copyright:** 2026 Sunny Simms Inc.

## App Privacy ("nutrition label")

Tracking: **No** (no data used to track across other companies' apps or websites; no ads, no analytics SDKs).
Matches `app/ios/App/App/PrivacyInfo.xcprivacy` and `site/privacy.html`.

| Data type | Collected | Linked to user | Purpose |
|---|---|---|---|
| Contact Info → Email Address | Yes (email or Apple sign-in) | Yes | App Functionality |
| Contact Info → Phone Number | Yes (only if they sign in by text) | Yes | App Functionality |
| Contact Info → Name | Yes | Yes | App Functionality |
| Location → Precise Location | Yes (only during a round they start) | Yes | App Functionality |
| User Content → Photos or Videos | Yes (profile photo) | Yes | App Functionality |
| User Content → Other User Content | Yes (scores, round details, reports) | Yes | App Functionality |
| Identifiers → User ID | Yes | Yes | App Functionality |
| Everything else (health, financial, contacts, browsing, search, purchases, usage data, diagnostics, device ID) | No | | |

## Age rating questionnaire

All "None" / "No", except:
- **User-generated content / social:** Yes. Users can see friends' names, photos and round progress. Mitigations to mention: friends-only visibility, report and block on every profile, reports reviewed within 24 hours.
- **Unrestricted web access:** No (links open only our own pages).
- **Location sharing:** disclosed above.
Expected result: 4+ (Apple may set 12+ for user-to-user sharing; accept whichever it computes).

## App Review information

- **Sign-in required:** Yes. Demo account (an email + password created for review, with buddies and a live round
  already playing so live sharing is visible without golfing): *see Sunny / the reviewer-account note; never commit it*.
- **Notes for the reviewer** (paste as-is):

```
FairWhere shares a golf round live with the friends you choose. The demo account is already buddies with "Mike Ross" and "Ann Lee", and Mike always has a round in progress at Redhawk Golf Club, so you can open him on the Buddies tab or the map and see his hole, pace, score and finish time update every few minutes.

To try a round yourself: Round tab -> Start sharing my round. If you're not near a golf course you'll be asked "Hey, it doesn't look like you're at a golf course" - choose Start anyway.

Location is used only while a round you start is live ("While Using" + the blue background indicator) to detect which hole you're on; it stops when the round ends. Sign in with Apple and Google are available on the sign-in screen. Report / Block are at the bottom of any buddy's page; Delete account is at the bottom of the Me tab.
```

## Filled in App Store Connect via the API (2026-10-08)

Subtitle, privacy policy URL, categories (Sports / Navigation), description, keywords, promotional text, support
and marketing URLs, copyright, build 1.0 (3) attached, price Free, age rating questionnaire (all None/No except
user-generated content = Yes), and all 10 screenshots (6.9" and 6.5"). Name set to **FairWhere: Golf Round Tracker** (2026-10-09).

Done by Sunny in the web UI (2026-10-09, verified via the API): age rating social-media questions = No; App Review
Information (contact, phone, demo login `review@fairwhere.app` + password matching `.review_account`, notes above).
Support email on the public pages is mrjosephsimms@gmail.com until fairwhere.app exists. **App Privacy** has no
API: confirm it shows Published before submitting.

## Screenshots

**Ready to upload:** `design/screenshots/out/6.9/` (1320 × 2868) and `out/6.5/` (1284 × 2778), in order:
1. "See which hole they're on": Buddies + map, Mike live on hole 10 at Redhawk.
2. "Know when they'll be done": Mike's round: hole, est. finish, pace, score.
3. "Get the alerts you choose": the bell: holes 9 & 18, 30 min before finish, teed off / finished.
4. "Follow the score hole by hole": front-nine scorecard.
5. "Start a round in seconds": Start a Round with the course picked from location.

Taken 2026-10-08 in the iPhone 17 Simulator, signed in as the reviewer demo account (Mike = demo golfer).
Regenerate with `python3 design/screenshots/make.py` after replacing `raw/`.
