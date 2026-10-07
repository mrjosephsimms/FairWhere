# Design references

Sites and libraries Sunny wants to draw from. Check a source's license before copying code or assets into the app.

## Animation
- **https://prompt-motion.com/**: animation inspiration Sunny wants to use in the app (saved 2026-10-07).
  Not reviewed yet: the cloud sandbox's network blocked the site. Open it in the browser and pick
  specific animations before building.

### Ground rules for animations in Find My Golfer
- Respect `prefers-reduced-motion`. `app/src/styles.css` already wraps its pulse animations in
  `@media (prefers-reduced-motion: no-preference)`, so follow that pattern.
- Prefer CSS transitions/keyframes on `transform`/`opacity` (cheap in the iOS WKWebView). Add a JS
  animation library only if a chosen effect needs it, and check its bundle size.
- Motion should carry meaning: a hole change, a friend's round going live, ETA updates, the
  "Sharing live" banner. Don't animate the list on every 30-second ETA tick.
- Use the existing color tokens (`--fairway`, `--flag`, ...) so animations work in light and dark mode.
