#!/usr/bin/env python3
"""Bulk-import every playable PUBLIC golf course in a region from OpenStreetMap
into data/courses.json (default region: Southern California).

Usage:
  python3 scripts/import_region.py              # discover, build, write data/courses.json
  python3 scripts/import_region.py --dry-run    # just print the report
  python3 scripts/import_region.py --report out.json   # also dump the found/added/skipped report

Pipeline (all raw responses cached in scripts/.osm_cache/, see osm_http.py):
 1. Overpass: every leisure=golf_course (ways, multipolygons, nodes) and every golf=hole /
    golf=green inside the region's counties.
 2. Each hole goes to the smallest course polygon containing its midpoint (or the nearest one
    within 250 m). Fragments of one course (an unnamed piece, "X - North" / "X - South") merge
    into one site; distinct named courses inside one facility stay separate.
 3. Per site: parse refs ("7", "Hole #7", "Creek 7", "7 (Canyon Course)", "7 Ranch Course"),
    group by golf:course:name / ref label / sibling-polygon name, collapse multi-tee duplicates
    (same number, same green), then keep only complete layouts:
      - 18 holes numbered 1-18                         -> plain 18 (nines = null)
      - named 9-hole loops numbered 1-9 (>= 2 loops)   -> a course with `nines`
      - 36 holes as two 1-18 sets, no labels           -> split into two 18s by routing
        (green of n -> tee of n+1), named "<site> · Course A/B" (flagged for renaming)
      - three unnamed 1-9 loops                        -> nines "A"/"B"/"C" (flagged)
    9-hole-only layouts are skipped (not supported by the app yet).
 4. Public only: access=private/no/members (or golf:course=private) is skipped; names with
    "Country Club"/military courses without an access tag are kept but flagged as unsure.
 5. Same par inference / green matching as fetch_course.py, same feature kinds as
    fetch_features.py (one Overpass bbox query per course), then size reduction: 6-decimal
    holes, 5-decimal features, Douglas-Peucker 1.5 m (greens 0.3 m), polygons clipped to the course box,
    woods only within 150 m of a hole, trees within 120 m, fairways/bunkers within 70 m,
    water within 160 m.
Courses named by --keep (default: redhawk, temecula-creek-inn) are kept exactly as they are and sites
overlapping them are skipped; every other course in data/courses.json is rebuilt by the import.
"""
from __future__ import annotations
import argparse, collections, json, math, pathlib, re, sys, unicodedata

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from osm_http import overpass, get_json, write_courses  # noqa: E402
from fetch_features import kind  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
COUNTIES = ["Los Angeles", "Orange", "San Diego", "Riverside", "San Bernardino", "Ventura", "Santa Barbara", "Imperial"]
AREA = ('area["name"="California"]["admin_level"="4"]["boundary"="administrative"]->.ca;\n'
        'rel(area.ca)["admin_level"="6"]["boundary"="administrative"]["name"~"^(' + "|".join(COUNTIES) + ') County$"];\n'
        'map_to_area->.region;')

# ----------------------------------------------------------------------------- geometry

R = 6371000.0

def meters(a, b):
    la = math.radians((a[0] + b[0]) / 2)
    return math.hypot(math.radians(b[1] - a[1]) * math.cos(la) * R, math.radians(b[0] - a[0]) * R)

def yd(a, b): return meters(a, b) * 1.09361

def cen(pts): return [round(sum(p[0] for p in pts) / len(pts), 6), round(sum(p[1] for p in pts) / len(pts), 6)]

class Proj:
    """Local equirectangular projection to meters around a reference point."""
    def __init__(self, ref):
        self.lat0, self.lng0 = ref
        self.kx = math.cos(math.radians(ref[0])) * math.pi / 180 * R
        self.ky = math.pi / 180 * R
    def xy(self, p): return ((p[1] - self.lng0) * self.kx, (p[0] - self.lat0) * self.ky)
    def ll(self, q): return (q[1] / self.ky + self.lat0, q[0] / self.kx + self.lng0)

def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def dp(pts, tol):
    """Douglas-Peucker on projected points."""
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, k = -1.0, -1
        for m in range(i + 1, j):
            d = seg_dist(pts[m], pts[i], pts[j])
            if d > best: best, k = d, m
        if best > tol:
            keep[k] = True; stack += [(i, k), (k, j)]
    return [p for p, f in zip(pts, keep) if f]

def simplify_ring(xy, tol):
    """DP a closed ring (first == last). Split at the farthest point from the start so the
    closing vertex isn't the only anchor."""
    if len(xy) < 5: return xy
    far = max(range(len(xy)), key=lambda i: math.hypot(xy[i][0] - xy[0][0], xy[i][1] - xy[0][1]))
    a = dp(xy[:far + 1], tol); b = dp(xy[far:], tol)
    out = a[:-1] + b
    return out if len(out) >= 4 else xy

def clip_ring(xy, box):
    """Sutherland-Hodgman clip of a ring to an axis-aligned box (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = box
    pts = xy[:-1] if xy and xy[0] == xy[-1] else xy[:]
    for edge in range(4):
        if not pts: break
        inside = [lambda p: p[0] >= x0, lambda p: p[0] <= x1, lambda p: p[1] >= y0, lambda p: p[1] <= y1][edge]
        def cut(p, q):
            if edge < 2:
                x = x0 if edge == 0 else x1; t = (x - p[0]) / (q[0] - p[0]); return (x, p[1] + t * (q[1] - p[1]))
            y = y0 if edge == 2 else y1; t = (y - p[1]) / (q[1] - p[1]); return (p[0] + t * (q[0] - p[0]), y)
        out = []
        for i, q in enumerate(pts):
            p = pts[i - 1]
            if inside(q):
                if not inside(p): out.append(cut(p, q))
                out.append(q)
            elif inside(p):
                out.append(cut(p, q))
        pts = out
    if len(pts) < 3: return []
    return pts + [pts[0]]

def area_m2(ring):
    if len(ring) < 4: return 0.0
    pr = Proj(ring[0]); xy = [pr.xy(p) for p in ring]
    return abs(sum(xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1] for i in range(len(xy) - 1))) / 2

def pip(p, ring):
    x, y = p[1], p[0]; ins = False
    for i in range(len(ring) - 1):
        (y1, x1), (y2, x2) = ring[i], ring[i + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: ins = not ins
    return ins

def join_rings(segs):
    segs = [list(s) for s in segs if len(s) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur = cur + s[1:]
                elif s[-1] == cur[-1]: cur = cur + s[::-1][1:]
                elif s[-1] == cur[0]: cur = s[:-1] + cur
                elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
                else: continue
                segs.pop(i); changed = True; break
        if cur[0] == cur[-1] and len(cur) >= 4: rings.append(cur)
    return rings

# ----------------------------------------------------------------------------- OSM load

def load_region():
    c = overpass(f'[out:json][timeout:240];{AREA}nwr["leisure"="golf_course"](area.region); out body; >; out skel qt;')
    h = overpass(f'[out:json][timeout:240];{AREA}(way["golf"="hole"](area.region); way["golf"="green"](area.region); '
                 f'relation["golf"="green"](area.region);); out body; >; out skel qt;')
    nodes = {e["id"]: (e["lat"], e["lon"]) for d in (c, h) for e in d["elements"] if e["type"] == "node"}
    cways = {e["id"]: e for e in c["elements"] if e["type"] == "way"}
    polys = []
    for e in c["elements"]:
        t = e.get("tags", {})
        if t.get("leisure") != "golf_course": continue
        if e["type"] == "way":
            rings = join_rings([[nodes[i] for i in e["nodes"] if i in nodes]])
        elif e["type"] == "relation":
            rings = join_rings([[nodes[i] for i in cways[m["ref"]]["nodes"] if i in nodes]
                                for m in e["members"] if m["type"] == "way" and m["role"] in ("outer", "") and m["ref"] in cways])
        else:
            rings = []
        if not rings and "lat" not in e: continue  # relation whose outer ways didn't resolve
        pts = [p for r in rings for p in r] or [(e["lat"], e["lon"])]
        polys.append({"osm": f"{e['type']}/{e['id']}", "tags": t, "name": clean_name(t.get("name")), "rings": rings,
                      "area": sum(area_m2(r) for r in rings),
                      "bbox": (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))})
    hways = {e["id"]: e for e in h["elements"] if e["type"] == "way"}
    greens = []
    for e in h["elements"]:
        t = e.get("tags", {})
        if t.get("golf") != "green": continue
        if e["type"] == "way":
            g = [nodes[i] for i in e["nodes"] if i in nodes]
            if len(g) >= 3: greens.append(g)
        else:
            for r in join_rings([[nodes[i] for i in hways[m["ref"]]["nodes"] if i in nodes]
                                 for m in e["members"] if m["type"] == "way" and m["role"] == "outer" and m["ref"] in hways]):
                greens.append(r)
    holes = []
    for e in h["elements"]:
        t = e.get("tags", {})
        if e["type"] != "way" or t.get("golf") != "hole": continue
        if any(k in t for k in ("abandoned", "disused", "razed")) or any(k.startswith(("abandoned:", "disused:")) for k in t): continue
        pts = [nodes[i] for i in e["nodes"] if i in nodes]
        if len(pts) < 2: continue
        holes.append({"osm": e["id"], "tags": t, "pts": pts})
    return polys, holes, greens

def clean_name(s):
    if not s: return None
    s = unicodedata.normalize("NFKC", s).replace("‎", "").replace("‏", "").strip()
    return re.sub(r"\s+", " ", s) or None

# ----------------------------------------------------------------------------- refs

REF_PATTERNS = [
    (re.compile(r"^(\d{1,2})$"), lambda m: (None, int(m[1]))),
    (re.compile(r"^hole\s*#?\s*(\d{1,2})$", re.I), lambda m: (None, int(m[1]))),
    (re.compile(r"^#\s*(\d{1,2})$"), lambda m: (None, int(m[1]))),
    (re.compile(r"^(\d{1,2})\s*\((.+?)(?:\s+(?:course|nine))?\)$", re.I), lambda m: (m[2].strip(), int(m[1]))),
    (re.compile(r"^(\d{1,2})\s+(.+?)(?:\s+(?:course|nine))?$", re.I), lambda m: (m[2].strip(), int(m[1]))),
    (re.compile(r"^'?(.+?)'?(?:\s+(?:course|nine))?\s+(?:hole\s*)?#?(\d{1,2})$", re.I), lambda m: (m[1].strip(), int(m[2]))),
]

def parse_ref(ref):
    if ref is None: return None
    ref = ref.strip()
    for rx, f in REF_PATTERNS:
        m = rx.match(ref)
        if m: return f(m)
    return None

def parse_par(t, L_yd):
    p = (t.get("par") or "").strip()
    if p.isdigit() and 3 <= int(p) <= 6: return int(p), False
    # same thresholds as fetch_course.py
    return (3 if L_yd < 250 else 4 if L_yd < 480 else 5), True

# ----------------------------------------------------------------------------- sites

def assign(polys, holes):
    for ho in holes:
        pts = ho["pts"]
        mid = pts[len(pts) // 2] if len(pts) > 2 else ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)
        ho["mid"] = mid
        best = None
        for pi, po in enumerate(polys):
            b = po["bbox"]
            if not po["rings"] or not (b[0] <= mid[0] <= b[2] and b[1] <= mid[1] <= b[3]): continue
            if any(pip(mid, r) for r in po["rings"]):
                if best is None or po["area"] < polys[best]["area"]: best = pi
        if best is None:  # nearest polygon vertex / node within 250 m
            bd = 250.0
            for pi, po in enumerate(polys):
                b = po["bbox"]
                if not (b[0] - 0.003 <= mid[0] <= b[2] + 0.003 and b[1] - 0.004 <= mid[1] <= b[3] + 0.004): continue
                cand = [p for r in po["rings"] for p in r] or [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)]
                d = min(meters(mid, p) for p in cand)
                if d < bd: bd, best = d, pi
        ho["poly"] = best

def name_from_holes(site):
    """Unnamed course polygon whose holes say which course they belong to (golf:course:name, or
    name="Admiral Baker North"): use the shared part of those names."""
    c = collections.Counter()
    for h in site["holes"]:
        t = h["tags"]
        v = t.get("golf:course:name") or t.get("course_name") or (t.get("name") if t.get("name") and not parse_ref(t["name"]) else None)
        if v: c[clean_name(v)] += 1
    if sum(c.values()) < 9: return None
    top = [n for n, _ in c.most_common(2)]
    if len(top) == 2:
        a, b = top[0].split(), top[1].split()
        k = 0
        while k < min(len(a), len(b)) and a[k] == b[k]: k += 1
        if k >= 2: return " ".join(a[:k])
    return top[0]

def base_name(n):
    """'Oaks North Golf Course - East' -> 'oaks north golf course'."""
    if not n: return None
    return re.split(r"\s+[-–—:]\s+", n.lower())[0].strip()

def bbox_gap_m(a, b):
    dlat = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dlng = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dlat * 111320, dlng * 111320 * math.cos(math.radians(a[0])))

def build_sites(polys, holes):
    """Union polygons that are pieces of one course; returns list of sites."""
    used = sorted({h["poly"] for h in holes if h["poly"] is not None})
    parent = {i: i for i in used}
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i in used:
        for j in used:
            if j <= i: continue
            a, b = polys[i], polys[j]
            if bbox_gap_m(a["bbox"], b["bbox"]) > 60: continue
            na, nb = base_name(a["name"]), base_name(b["name"])
            if na is None or nb is None or na == nb:
                parent[find(i)] = find(j)
    sites = collections.defaultdict(lambda: {"polys": [], "holes": []})
    for i in used: sites[find(i)]["polys"].append(i)
    for h in holes:
        if h["poly"] is not None: sites[find(h["poly"])]["holes"].append(h)
    out = []
    for s in sites.values():
        named = [polys[i] for i in s["polys"] if polys[i]["name"]]
        # Site name: the named polygon holding the most holes, else the largest named one.
        cnt = collections.Counter(h["poly"] for h in s["holes"])
        named.sort(key=lambda p: (-cnt.get(polys.index(p), 0), -p["area"]))
        name = named[0]["name"] if named else None
        if named and len({base_name(p["name"]) for p in named}) == 1 and len({p["name"] for p in named}) > 1:
            name = re.split(r"\s+[-–—:]\s+", named[0]["name"])[0].strip()
        out.append({"name": name, "polys": [polys[i] for i in s["polys"]], "holes": s["holes"]})
    loose = [h for h in holes if h["poly"] is None]
    return out, loose

# ----------------------------------------------------------------------------- layouts

GENERIC = r"\b(the|golf|course|courses|club|country|resort|links|&|and)\b"

def same_course_name(a, b):
    """True when label `a` just repeats the site name `b`, e.g. 'Oak Glen' for 'Oak Glen Golf Course'
    (but not 'North' for 'Oaks North Golf Course')."""
    if not a or not b: return False
    strip = lambda s: re.sub(GENERIC, " ", re.sub(r"[^\w&]+", " ", s.lower())).split()
    return a.lower() == b.lower() or strip(a) == strip(b) or base_name(a) == base_name(b)

def drop_prefix(label, site_name):
    """'Admiral Baker North' under site 'Admiral Baker' -> 'North'."""
    if label and site_name and label.lower().startswith(site_name.lower() + " "):
        return label[len(site_name):].strip(" -·") or label
    return label

def label_of(h, site):
    """-> (sub-course name, loop label); also sets h['num']."""
    t = h["tags"]
    pr = parse_ref(t.get("ref"))
    if pr is None and t.get("name"):
        pr = parse_ref(t["name"])  # e.g. name="Oak Glen 10" on a way with no ref
    h["num"] = pr[1] if pr else None
    lab = pr[0] if pr else None
    sub = clean_name(t.get("golf:course:name") or t.get("course_name"))
    if not sub and t.get("name") and not parse_ref(t["name"]) and site.get("name_from_holes"):
        sub = clean_name(t["name"])  # unnamed polygon: holes carry "Admiral Baker North" etc.
    # Several differently named polygons in one site (e.g. "X - East", "X - North"): their suffix names the loop.
    pnames = {p["name"] for p in site["polys"] if p["name"]}
    if not lab and len(pnames) > 1 and h.get("_poly_name") and re.search(r"\s[-–—]\s", h["_poly_name"]):
        lab = re.split(r"\s+[-–—]\s+", h["_poly_name"])[-1].strip()
    sub, lab = drop_prefix(sub, site["name"]), drop_prefix(lab, site["name"])
    if sub and same_course_name(sub, site["name"]): sub = None
    if lab and same_course_name(lab, site["name"]): lab = None
    if sub and lab and (sub.lower() in lab.lower() or lab.lower() in sub.lower()):
        sub, lab = (lab if len(lab) > len(sub) else sub), None
    return sub, lab

def dedupe_tees(hs):
    """Multiple ways for one hole (one per tee box) share a number and a green: keep the longest."""
    by = collections.defaultdict(list)
    for h in hs: by[h["num"]].append(h)
    out = []
    for n, lst in by.items():
        lst.sort(key=lambda h: -h["L"])
        kept = []
        for h in lst:
            if any(meters(h["pts"][-1], k["pts"][-1]) < 35 for k in kept): continue
            kept.append(h)
        out += kept
    return out

def chain_split(hs, k, numbers):
    """Split holes where each number in `numbers` appears k times into k routings, minimizing
    the walk from each green to the next tee. Returns k lists ordered by number, or None."""
    import itertools
    by = collections.defaultdict(list)
    for h in hs: by[h["num"]].append(h)
    if any(len(by[n]) != k for n in numbers): return None
    perms = list(itertools.permutations(range(k)))
    # dp[perm] = (cost, back); chain c at step i uses by[n][perm[c]]
    cost = {p: 0.0 for p in perms}; back = []
    for i in range(1, len(numbers)):
        prev, cur = by[numbers[i - 1]], by[numbers[i]]
        nc, bk = {}, {}
        for p in perms:
            best = None
            for q in perms:
                c = cost[q] + sum(meters(prev[q[ch]]["pts"][-1], cur[p[ch]]["pts"][0]) for ch in range(k))
                if best is None or c < best[0]: best = (c, q)
            nc[p], bk[p] = best
        cost = nc; back.append(bk)
    p = min(cost, key=cost.get)
    seq = [p]
    for bk in reversed(back):
        p = bk[p]; seq.append(p)
    seq.reverse()
    chains = [[by[n][seq[i][ch]] for i, n in enumerate(numbers)] for ch in range(k)]
    # Sanity: each step within a routing should be a plausible walk (< 700 m green -> next tee).
    worst = max(meters(c[i]["pts"][-1], c[i + 1]["pts"][0]) for c in chains for i in range(len(c) - 1))
    return chains if worst < 700 else None

def compass(site_c, pts):
    c = cen(pts)
    dy, dx = c[0] - site_c[0], (c[1] - site_c[1]) * math.cos(math.radians(c[0]))
    if abs(dy) >= abs(dx): return "North" if dy > 0 else "South"
    return "East" if dx > 0 else "West"

def walk(seq):
    return [meters(seq[i]["pts"][-1], seq[i + 1]["pts"][0]) for i in range(len(seq) - 1)]

MAX_WALK = 450  # m, green -> next tee, for a repaired routing to be believable

def repair(hs, spare, N):
    """A loop that should be 1..N but has one or two wrong/missing refs: pick the routing
    (which duplicate fills the gap, which unnumbered way is the missing hole) with the
    shortest green->tee walks. Returns (ordered holes, note) or None."""
    import itertools
    by = collections.defaultdict(list)
    for h in hs:
        if 1 <= h["num"] <= N: by[h["num"]].append(h)
    missing = [n for n in range(1, N + 1) if not by[n]]
    dups = [h for n in by for h in by[n]] if any(len(v) > 1 for v in by.values()) else []
    pool = [h for n in by if len(by[n]) > 1 for h in by[n]] + list(spare)
    if len(missing) > 2 or len(pool) > 8 or (not missing and not dups): return None
    if missing and not pool: return None
    best = None
    fixed = {n: v[0] for n, v in by.items() if len(v) == 1}
    dupnums = [n for n, v in by.items() if len(v) > 1]
    for fill in itertools.permutations(pool, len(missing)):
        rest = [h for h in pool if h not in fill]
        # every duplicated number keeps one of its remaining candidates
        choices = []
        for n in dupnums:
            c = [h for h in by[n] if h in rest]
            if not c: break
            choices.append(c)
        else:
            for pick in itertools.product(*choices) if choices else [()]:
                m = dict(fixed); m.update(zip(dupnums, pick)); m.update(zip(missing, fill))
                if len(m) != N or len({id(h) for h in m.values()}) != N: continue
                seq = [m[n] for n in range(1, N + 1)]
                w = walk(seq)
                score = sum(w)
                if best is None or score < best[0]: best = (score, max(w), seq)
    if best is None or best[1] > MAX_WALK: return None
    seq = best[2]
    changed = [f"way {h['osm']} (ref={h['tags'].get('ref', '-')}) used as hole {i + 1}"
               for i, h in enumerate(seq) if h["num"] != i + 1]
    for i, h in enumerate(seq): h["num"] = i + 1
    return seq, "OSM refs repaired by routing: " + "; ".join(changed) if changed else "duplicate hole ways dropped by routing"

def layouts(site):
    """-> (list of (suffix, nines|None, holes-or-{nine: holes}), notes, reasons-not-added)"""
    hs = site["holes"]
    for h in hs:
        h["L"] = sum(yd(h["pts"][i], h["pts"][i + 1]) for i in range(len(h["pts"]) - 1))
    groups = collections.defaultdict(list)
    for h in hs:
        sub, lab = label_of(h, site)
        groups[(sub, lab)].append(h)
    out, notes, reasons = [], [], []
    spare = groups.pop((None, None), [])
    unnum = [h for h in spare if h["num"] is None]
    unl = dedupe_tees([h for h in spare if h["num"] is not None])
    nines, eighteens = {}, []
    def title(sub, lab): return " · ".join(x for x in (sub, lab) if x) or None

    for (sub, lab), v in sorted(groups.items(), key=lambda kv: (kv[0][0] or "", kv[0][1] or "")):
        stray = [h for h in v if h["num"] is None]
        v = dedupe_tees([h for h in v if h["num"] is not None])
        nums = sorted(h["num"] for h in v)
        name = title(sub, lab)
        if not nums:
            reasons.append(f"'{name}' has {len(stray)} hole ways without a ref"); continue
        if nums == list(range(1, 10)) or nums == list(range(10, 19)):
            nines[lab or sub] = sorted(v, key=lambda h: h["num"])
        elif nums == list(range(1, 19)):
            eighteens.append((name, sorted(v, key=lambda h: h["num"])))
        else:
            N = 18 if max(nums) > 9 else 9
            fixed = repair(v, stray, N) if len(v) + len(stray) >= N - 2 else None
            if fixed:
                (eighteens.append((name, fixed[0])) if N == 18 else nines.__setitem__(lab or sub, fixed[0]))
                notes.append(f"{name}: {fixed[1]}")
            else:
                reasons.append(f"'{name}' has holes {compress(nums)}" + (f" (+{len(stray)} without ref)" if stray else ""))

    nums = sorted(h["num"] for h in unl)
    cnt = collections.Counter(nums)
    if unl:
        sc = cen([h["mid"] for h in unl])
        if nums == list(range(1, 19)):
            eighteens.append((None, sorted(unl, key=lambda h: h["num"])))
            if unnum: notes.append(f"{len(unnum)} hole way(s) without a usable ref ignored")
        elif nums == list(range(1, 10)) and (nines or eighteens):
            reasons.append("an unlabeled 9-hole loop next to the named course(s)")
        elif nums == list(range(1, 10)) and len(nines) == 1:
            reasons.append("an unlabeled 9 next to one labeled 9")
        elif set(cnt) == set(range(1, 19)) and set(cnt.values()) == {2}:
            ch = chain_split(unl, 2, list(range(1, 19)))
            if ch:
                names = [compass(sc, [h["mid"] for h in c]) for c in ch]
                names = [f"{n} course" for n in names] if len(set(names)) == 2 else ["Course A", "Course B"]
                for nm, c in zip(names, ch): eighteens.append((nm, c))
                notes.append("PLACEHOLDER NAMES: two unlabeled 18s in one polygon, split by routing")
            else:
                reasons.append("36 unlabeled holes that don't split cleanly into two routings")
        elif set(cnt) == set(range(1, 10)) and set(cnt.values()) == {3}:
            ch = chain_split(unl, 3, list(range(1, 10)))
            if ch:
                names = [compass(sc, [h["mid"] for h in c]) for c in ch]
                if len(set(names)) < 3: names = ["A", "B", "C"]
                for nm, c in zip(names, ch): nines[nm] = c
                notes.append("PLACEHOLDER NAMES: three unlabeled nines, split by routing")
            else:
                reasons.append("27 unlabeled holes that don't split cleanly into three nines")
        elif set(cnt) == set(range(1, 19)) and all(cnt[n] == 2 for n in range(1, 10)) and all(cnt[n] == 1 for n in range(10, 19)):
            ones = sorted((h for h in unl if h["num"] >= 10), key=lambda h: h["num"])
            ch = chain_split([h for h in unl if h["num"] <= 9], 2, list(range(1, 10)))
            if ch:
                ch.sort(key=lambda c: meters(c[-1]["pts"][-1], ones[0]["pts"][0]))
                eighteens.append((None, ch[0] + ones))
                reasons.append("a separate unlabeled 9-hole loop (9-hole courses not supported yet)")
            else:
                reasons.append("27 holes (18 + 9) that don't split cleanly")
        elif nums == list(range(1, 28)):
            for i, lab in enumerate(["1-9", "10-18", "19-27"]):
                nines[f"Holes {lab}"] = [h for h in unl if 9 * i < h["num"] <= 9 * i + 9]
            notes.append("PLACEHOLDER NAMES: 27 holes numbered 1-27; nines named by hole numbers")
        elif nums == list(range(1, 10)) and not eighteens and not nines:
            fixed = None
            reasons.append("9-hole course")
        else:
            N = 18 if max(nums) > 9 else 9
            fixed = repair(unl, unnum, N) if len(unl) + len(unnum) >= N - 2 and len(unl) <= N + 3 else None
            if fixed:
                eighteens.append((None, fixed[0])) if N == 18 else None
                notes.append(fixed[1])
                if N == 9: reasons.append("9-hole course")
            else:
                miss = sorted(set(range(1, 19 if N == 18 else 10)) - set(cnt))
                dup = sorted(n for n, c in cnt.items() if c > 1)
                extra = sorted(n for n in cnt if not 1 <= n <= 18)
                bits = []
                if miss: bits.append(f"missing {compress(miss)}")
                if dup: bits.append(f"duplicate {compress(dup)}")
                if extra: bits.append(f"extra {compress(extra)}")
                if unnum: bits.append(f"{len(unnum)} without ref")
                reasons.append(f"{len(nums)} numbered holes ({', '.join(bits) or compress(nums)})")
    elif unnum and not groups:
        reasons.append(f"{len(unnum)} hole ways, none with a ref")

    if len(nines) >= 2:
        out.append((None, sorted(nines), nines))
    elif len(nines) == 1:
        reasons.append(f"only one complete 9-hole loop ({next(iter(nines))})")
    for name, v in eighteens:
        out.append((name, None, v))
    return out, notes, reasons

def compress(nums):
    nums = sorted(set(nums)); out = []; i = 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1: j += 1
        out.append(str(nums[i]) if i == j else f"{nums[i]}-{nums[j]}"); i = j + 1
    return ",".join(out)

# ----------------------------------------------------------------------------- course records

def hole_record(h, greens_idx, nine=None, number=None):
    pts = h["pts"]; t = h["tags"]
    L = h["L"]
    par, inferred = parse_par(t, L)
    g = nearest_green(greens_idx, pts[-1])
    num = number if number is not None else h["num"]
    ref = f"{nine} {num}" if nine else str(num)
    return {"ref": ref, "nine": nine, "number": num, "par": par, "parInferred": inferred, "yards": round(L),
            "centerline": [[round(p[0], 6), round(p[1], 6)] for p in pts],
            "green": {"center": cen(g), "polygon": simplify_green(g)} if g else None}

GREEN_TOL_M = 0.3

def simplify_green(g):
    """Greens are traced with many nodes; 0.3 m Douglas-Peucker is invisible and halves the size."""
    ring = list(g) if g[0] == g[-1] else list(g) + [g[0]]
    pr = Proj(ring[0])
    xy = simplify_ring([pr.xy(p) for p in ring], GREEN_TOL_M)
    out = []
    for q in xy:
        p = pr.ll(q); r6 = [round(p[0], 6), round(p[1], 6)]
        if not out or out[-1] != r6: out.append(r6)
    return out

class GreenIndex:
    def __init__(self, greens):
        self.cells = collections.defaultdict(list)
        for g in greens:
            c = cen(g); self.cells[(int(c[0] * 200), int(c[1] * 200))].append((c, g))
    def near(self, p):
        i, j = int(p[0] * 200), int(p[1] * 200)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                yield from self.cells.get((i + di, j + dj), [])

def nearest_green(idx, end):
    best = None
    for c, g in idx.near(end):
        d = yd(c, end)
        if d < 60 and (best is None or d < best[0]): best = (d, g)
    return best[1] if best else None

# OSM polygons whose name alone is too generic to show in a course list (checked against the map).
NAME_OVERRIDES = {
    "way/25841862": "Balboa Park Golf Course · Championship Course",  # San Diego; its 9-hole Executive Course is skipped
    "relation/4080606": "Lawrence Welk Resort · Fountains Course",    # Escondido
}

ACCESS_PRIVATE = {"private", "no", "members", "member"}

def access_class(site):
    tags = [p["tags"] for p in site["polys"]]
    for t in tags:
        if t.get("access", "").lower() in ACCESS_PRIVATE or t.get("golf:course", "").lower() == "private" \
                or t.get("membership", "").lower() in ("required", "yes") or t.get("ownership", "").lower() == "private":
            return "private", f"access={t.get('access') or t.get('golf:course') or t.get('membership') or t.get('ownership')}"
    if re.search(r"\bprivate\b", (site["name"] or "").lower()):
        return "private", "name says Private"
    for t in tags:
        if t.get("access", "").lower() in ("yes", "public", "permissive", "customers", "fee") or t.get("fee") == "yes":
            return "public", None
    for t in tags:
        if t.get("access", "").lower() in ("permit", "military", "designated"):
            return "unsure", f"access={t['access']}"
    nm = (site["name"] or "").lower()
    if re.search(r"country club|\bcc\b", nm): return "unsure", "name says Country Club, no access tag"
    if re.search(r"\bnavy\b|\bmarine\b|\bair force\b|\bmilitary\b|admiral|\bbase\b|miramar|pendleton|edwards|seal beach", nm):
        return "unsure", "military course (base access)"
    return "public", None

def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[’'`]", "", s)
    s = re.sub(r"\b(golf course|golf club|golf links|golf resort|golf & country club|golf and country club|the)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = re.sub(r"^at-", "", s)
    return s[:48].rstrip("-")

# ----------------------------------------------------------------------------- address

STATE = {"California": "CA"}

def place_for(center):
    """(city or None, county) from Nominatim reverse geocoding (cached)."""
    r = get_json("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1"
                 f"&lat={center[0]:.5f}&lon={center[1]:.5f}")
    a = r.get("address", {})
    return (a.get("city") or a.get("town") or a.get("village")), a.get("county")

def address_for(site, city, county):
    """The course's own addr:* tags when mapped, else just "City, CA" (reverse-geocoded
    street/postcode for a big polygon's centroid is too often wrong to show)."""
    for p in site["polys"]:
        t = p["tags"]
        if t.get("addr:street"):
            street = " ".join(x for x in (t.get("addr:housenumber"), t["addr:street"]) if x)
            rest = " ".join(x for x in ("CA", t.get("addr:postcode")) if x)
            return ", ".join(x for x in (street, t.get("addr:city") or city, rest) if x)
    return f"{city or county}, CA" if (city or county) else None

# ----------------------------------------------------------------------------- features

FEATURE_Q = """[out:json][timeout:120][bbox:{s},{w},{n},{e}];
(
  way["golf"~"^(fairway|bunker|water_hazard|lateral_water_hazard)$"];
  relation["golf"~"^(fairway|bunker|water_hazard|lateral_water_hazard)$"];
  way["natural"~"^(sand|water|wood|scrub)$"];
  relation["natural"~"^(sand|water|wood|scrub)$"];
  way["water"]; relation["water"];
  way["landuse"~"^(reservoir|basin|forest)$"];
  relation["landuse"~"^(reservoir|basin|forest)$"];
  node["natural"="tree"];
);
out body; >; out skel qt;"""

KEEP_M = {"fairways": 70, "bunkers": 70, "water": 160, "woods": 150}
TREE_M = 120
PAD_M = 200
TOL_M = 1.5

def fetch_features(holes):
    pts = [p for h in holes for p in h["centerline"]]
    s, n = min(p[0] for p in pts), max(p[0] for p in pts)
    w, e = min(p[1] for p in pts), max(p[1] for p in pts)
    pad_lat = PAD_M / 111320 + 0.0005
    pad_lng = PAD_M / (111320 * math.cos(math.radians((s + n) / 2))) + 0.0005
    S, W, N, E = round(s - pad_lat, 4), round(w - pad_lng, 4), round(n + pad_lat, 4), round(e + pad_lng, 4)
    try:
        d = overpass(FEATURE_Q.format(s=S, w=W, n=N, e=E), timeout=120, attempts=4)
    except Exception as ex:  # Overpass overloaded: same element shape from the plain map API
        print(f"  Overpass failed ({ex}); using the OSM map API for this course", flush=True)
        d = get_json(f"https://api.openstreetmap.org/api/0.6/map.json?bbox={W},{S},{E},{N}")
    els = d["elements"]
    nodes = {x["id"]: x for x in els if x["type"] == "node"}
    ways = {x["id"]: x for x in els if x["type"] == "way"}
    ll = lambda way: [(nodes[i]["lat"], nodes[i]["lon"]) for i in way["nodes"] if i in nodes]
    raw = {"fairways": [], "bunkers": [], "water": [], "woods": []}
    for x in ways.values():
        k = kind(x.get("tags", {}))
        if k and len(x["nodes"]) >= 4 and x["nodes"][0] == x["nodes"][-1]:
            raw[k].append(ll(x))
    for r in (x for x in els if x["type"] == "relation"):
        k = kind(r.get("tags", {}))
        if not k: continue
        outers = [ll(ways[m["ref"]]) for m in r.get("members", []) if m["type"] == "way" and m.get("role") == "outer" and m["ref"] in ways]
        raw[k] += join_rings(outers)
    trees = [(x["lat"], x["lon"]) for x in nodes.values() if x.get("tags", {}).get("natural") == "tree"]
    return reduce_features(holes, raw, trees)

def reduce_features(holes, raw, trees):
    pts = [p for h in holes for p in h["centerline"]]
    pr = Proj(cen(pts))
    lines = [[pr.xy(p) for p in h["centerline"]] for h in holes]
    xs = [q[0] for l in lines for q in l]; ys = [q[1] for l in lines for q in l]
    box = (min(xs) - PAD_M, min(ys) - PAD_M, max(xs) + PAD_M, max(ys) + PAD_M)
    segs = [(l[i], l[i + 1]) for l in lines for i in range(len(l) - 1)]
    def off(q, lim):
        for a, b in segs:
            if abs(q[0] - a[0]) > lim + 600 and abs(q[0] - b[0]) > lim + 600: continue
            if seg_dist(q, a, b) < lim: return True
        return False
    out = {"fairways": [], "bunkers": [], "water": [], "woods": [], "trees": []}
    seen = set()
    for k, rings in raw.items():
        for ring in rings:
            key = (k, tuple(ring[:3]), len(ring))
            if key in seen: continue
            seen.add(key)
            xy = clip_ring([pr.xy(p) for p in ring], box)
            if len(xy) < 4: continue
            xy = simplify_ring(xy, TOL_M)
            if len(xy) < 4: continue
            if not any(off(q, KEEP_M[k]) for q in xy): continue
            poly = []
            for q in xy:
                p = pr.ll(q); r5 = [round(p[0], 5), round(p[1], 5)]
                if not poly or poly[-1] != r5: poly.append(r5)
            if len(poly) >= 4: out[k].append(poly)
    tseen = set()
    for t in trees:
        q = pr.xy(t)
        if not (box[0] <= q[0] <= box[2] and box[1] <= q[1] <= box[3]) or not off(q, TREE_M): continue
        r5 = (round(t[0], 5), round(t[1], 5))
        if r5 in tseen: continue
        tseen.add(r5); out["trees"].append(list(r5))
    return out

# ----------------------------------------------------------------------------- main

def overlaps_existing(holes, existing):
    for c in existing:
        for h in c["holes"]:
            for oh in holes:
                if meters(h["centerline"][-1], oh["pts"][-1]) < 60: return c["id"]
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-features", action="store_true")
    ap.add_argument("--report")
    ap.add_argument("--keep", default="redhawk,temecula-creek-inn",
                    help="course ids in data/courses.json to keep untouched; every other course is rebuilt from this import")
    a = ap.parse_args()

    path = ROOT / "data" / "courses.json"
    db = json.loads(path.read_text())
    existing = [c for c in db["courses"] if c["id"] in a.keep.split(",")]
    polys, holes, greens = load_region()
    assign(polys, holes)
    for h in holes:
        h["_poly_name"] = polys[h["poly"]]["name"] if h["poly"] is not None else None
    sites, loose = build_sites(polys, holes)
    gidx = GreenIndex(greens)
    flipped = orient_holes(holes, gidx)
    if flipped: print(f"{flipped} hole ways drawn green -> tee were reversed")
    named_courses = [p for p in polys if not re.search(r"driving range|pitch|putt|mini", (p["name"] or "").lower())]
    report = {"found": [], "added": [], "skipped": []}
    used_ids = {c["id"] for c in existing}
    new = []
    sites.sort(key=lambda s: (s["name"] or "~", s["polys"][0]["osm"]))
    for site in sites:
        site_center = cen([h["mid"] for h in site["holes"]])
        osm = ", ".join(p["osm"] for p in site["polys"])
        if not site["name"]:
            site["name"] = name_from_holes(site); site["name_from_holes"] = bool(site["name"])
        site["name"] = NAME_OVERRIDES.get(site["polys"][0]["osm"], site["name"])
        nm = site["name"]
        ent = {"name": nm or "(unnamed)", "osm": osm, "holes": len(site["holes"])}
        report["found"].append(ent)
        if not nm:
            report["skipped"].append({**ent, "reason": "no name on the OSM course polygon"}); continue
        if re.search(r"driving range|pitch ?(and|&|n) ?putt|mini(ature)? golf|putting", nm.lower()) or \
                any(p["tags"].get("golf:course") in ("driving_range", "pitch_and_putt", "miniature") for p in site["polys"]):
            report["skipped"].append({**ent, "reason": "driving range / pitch & putt"}); continue
        ex = overlaps_existing(site["holes"], existing)
        if ex:
            report["skipped"].append({**ent, "reason": f"already in the app ({ex}), kept as is"}); continue
        acc, why = access_class(site)
        if acc == "private":
            report["skipped"].append({**ent, "reason": f"private ({why})"}); continue
        lays, notes, reasons = layouts(site)
        if not lays:
            r = "; ".join(reasons) or "no complete layout"
            if "9-hole course" in r and len(reasons) == 1: r = "9-hole course (not supported yet)"
            else: r = "incomplete holes: " + r
            report["skipped"].append({**ent, "reason": r}); continue
        city, county = place_for(site_center)
        address = address_for(site, city, county)
        for suffix, nines, hs in lays:
            name = f"{nm} · {suffix}" if suffix else nm
            if nines:
                recs = []
                for lab in nines:
                    loop = hs[lab]
                    for i, h in enumerate(loop):
                        recs.append(hole_record(h, gidx, nine=lab, number=i + 1))
            else:
                recs = [hole_record(h, gidx) for h in hs]
            mw = max_walk({"nines": nines, "holes": recs})
            if mw > MAX_ROUTE_WALK:
                report["skipped"].append({**ent, "name": name, "reason": f"incomplete holes: routing doesn't hold together "
                                          f"(a {round(mw)} m walk between consecutive holes; refs likely wrong)"})
                continue
            cid = slug(name) or slug(nm)
            base, k = cid, 2
            while cid in used_ids: cid, k = f"{base}-{k}", k + 1
            used_ids.add(cid)
            course = {"id": cid, "name": name, "address": address or None, "nines": nines, "holes": recs}
            if not a.no_features:
                course["features"] = fetch_features(recs)
            new.append(course)
            f = course.get("features") or {}
            report["added"].append({"id": cid, "name": name, "city": city, "county": county, "osm": osm,
                                    "holes": len(recs), "nines": nines, "access": acc, "access_note": why, "notes": notes,
                                    "inferred_pars": sum(h["parInferred"] for h in recs),
                                    "max_walk_m": round(max_walk(course)),
                                    "greens": sum(1 for h in recs if h["green"]),
                                    "features": {k2: len(v) for k2, v in f.items()},
                                    "bytes": len(json.dumps(course, separators=(",", ":")))})
            print(f"+ {cid}: {len(recs)} holes" + (f" nines={nines}" if nines else "") + (f" [{acc}: {why}]" if why else "")
                  + (" " + "; ".join(notes) if notes else ""), flush=True)
        for r in reasons:
            if lays: report["skipped"].append({**ent, "reason": f"part of the site not added: {r}"})
    # loose holes (no course polygon near them)
    cl = cluster([h for h in loose], 400)
    for c in cl:
        report["found"].append({"name": "(no course polygon)", "osm": f"holes near {cen([h['mid'] for h in c])}", "holes": len(c)})
        report["skipped"].append({"name": "(no course polygon)", "osm": f"holes near {cen([h['mid'] for h in c])}",
                                  "holes": len(c), "reason": "hole ways not inside any leisure=golf_course polygon"})
    print(f"\nsites {len(sites)} (+{len(cl)} loose clusters), added {len(report['added'])} courses, skipped {len(report['skipped'])}")
    if a.report:
        pathlib.Path(a.report).write_text(json.dumps(report, indent=1, ensure_ascii=False))
    if a.dry_run: return
    new.sort(key=lambda c: c["name"].lower())
    db["courses"] = existing + new
    write_courses(path, db)

MAX_ROUTE_WALK = 700  # m between a green and the next tee; more means the refs are wrong

def orient_holes(holes, gidx):
    """golf=hole ways must run tee -> green. Reverse ones whose start sits on a green and end doesn't."""
    n = 0
    for h in holes:
        a, b = nearest_green(gidx, h["pts"][0]), nearest_green(gidx, h["pts"][-1])
        if a is None or b is not None: continue
        if yd(cen(a), h["pts"][0]) < 35:
            h["pts"] = h["pts"][::-1]; n += 1
    return n

def max_walk(course):
    """Longest green -> next tee walk over every playable order (sanity check on the routing)."""
    hs = course["holes"]
    if course["nines"]:
        loops = [[h for h in hs if h["nine"] == n] for n in course["nines"]]
        w = [meters(l[i]["centerline"][-1], l[i + 1]["centerline"][0]) for l in loops for i in range(len(l) - 1)]
    else:
        w = [meters(hs[i]["centerline"][-1], hs[i + 1]["centerline"][0]) for i in range(len(hs) - 1)]
    return max(w)

def cluster(hs, m):
    """Single-linkage clusters of holes (midpoints closer than m meters)."""
    parent = list(range(len(hs)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i in range(len(hs)):
        for j in range(i + 1, len(hs)):
            if meters(hs[i]["mid"], hs[j]["mid"]) < m: parent[find(i)] = find(j)
    groups = collections.defaultdict(list)
    for i, h in enumerate(hs): groups[find(i)].append(h)
    return list(groups.values())

if __name__ == "__main__":
    main()
