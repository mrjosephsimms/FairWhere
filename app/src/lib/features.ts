// v1 scope (docs/LAUNCH_GOAL.md step 1): finished features held back from the first App Store
// release. Hidden, not deleted: flip a flag to bring one back (and re-add anything it needs,
// e.g. everyday location's "Always" purpose string in ios/App/App/Info.plist).
export const features = {
  /** The 3D "play this hole" game on a buddy's round. */
  game: false,
  /** Sharing your location with chosen buddies outside a round (needs iOS "Always"). */
  everydayLocation: false,
  /** Map tools on a round: yardage tags, measure, hazards, layup rings. */
  mapTools: false,
} as const;
