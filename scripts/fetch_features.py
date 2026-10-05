#!/usr/bin/env python3
"""Add each course's mapped features (fairways, bunkers, water, woods, trees) to
data/courses.json from OpenStreetMap, for the 3D "Play this hole" game and lies.

Usage:  python3 scripts/fetch_features.py            # every course in courses.json
        python3 scripts/fetch_features.py redhawk    # just one

Uses the plain OSM map API over the box around the course's holes (same source as
scripts/fetch_course.py; Overpass isn't needed). Polygons are [[lat, lng], ...];
multipolygon relations contribute their closed outer ways.
Then: node scripts/gen_course_seed.mjs supabase/migrations/<new>.sql
"""
import json, pathlib, sys, urllib.request

UA = {"User-Agent": "fairwhere/0.1 (course features import)"}
PAD = 0.0025  # ~250 m around the holes

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return json.load(r)

def kind(t):
    g, n, w, lu = t.get("golf"), t.get("natural"), t.get("water"), t.get("landuse")
    if g == "fairway": return "fairways"
    if g == "bunker" or (n == "sand" and g is None): return "bunkers"
    if g in ("water_hazard", "lateral_water_hazard") or n == "water" or w or lu in ("reservoir", "basin"): return "water"
    if n in ("wood", "scrub") or lu == "forest": return "woods"
    return None

def main():
    path = pathlib.Path(__file__).resolve().parent.parent / "data" / "courses.json"
    db = json.loads(path.read_text())
    only = set(sys.argv[1:])
    for c in db["courses"]:
        if only and c["id"] not in only: continue
        pts = [p for h in c["holes"] for p in h["centerline"]]
        s, n = min(p[0] for p in pts) - PAD, max(p[0] for p in pts) + PAD
        w, e = min(p[1] for p in pts) - PAD, max(p[1] for p in pts) + PAD
        d = get(f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w},{s},{e},{n}")
        els = d["elements"]
        nodes = {x["id"]: x for x in els if x["type"] == "node"}
        ways = {x["id"]: x for x in els if x["type"] == "way"}
        poly = lambda way: [[round(nodes[i]["lat"], 6), round(nodes[i]["lon"], 6)] for i in way["nodes"] if i in nodes]
        feats = {"fairways": [], "bunkers": [], "water": [], "woods": [], "trees": []}
        for x in ways.values():
            k = kind(x.get("tags", {}))
            if k and len(x["nodes"]) >= 4 and x["nodes"][0] == x["nodes"][-1]:
                feats[k].append(poly(x))
        for r in (x for x in els if x["type"] == "relation"):
            k = kind(r.get("tags", {}))
            if not k: continue
            for m in r.get("members", []):
                wy = ways.get(m["ref"]) if m["type"] == "way" and m.get("role") == "outer" else None
                if wy and len(wy["nodes"]) >= 4 and wy["nodes"][0] == wy["nodes"][-1]:
                    feats[k].append(poly(wy))
        feats["trees"] = [[round(x["lat"], 6), round(x["lon"], 6)] for x in nodes.values() if x.get("tags", {}).get("natural") == "tree"]
        c["features"] = feats
        print(f"{c['id']}: " + ", ".join(f"{len(v)} {k}" for k, v in feats.items()))
    path.write_text(json.dumps(db, indent=1))

if __name__ == "__main__":
    main()
