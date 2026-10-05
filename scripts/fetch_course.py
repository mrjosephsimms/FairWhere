#!/usr/bin/env python3
"""Add a golf course to data/courses.json from OpenStreetMap.

Usage:  python3 scripts/fetch_course.py "Pala Mesa Resort golf" [--id pala-mesa]

Steps: Nominatim finds the course boundary box -> the OSM map API returns
everything inside it -> keep golf=hole ways (tee->green centerlines, with ref/par tags)
and golf=green polygons. Holes with no par tag get one inferred from length.
Not every course has holes mapped in OSM; the script says so if none are found.
(Overpass API was unreachable from the build sandbox; the plain map API works.)
"""
import json, math, sys, urllib.parse, urllib.request, argparse, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from osm_http import write_courses  # noqa: E402

UA = {"User-Agent": "find-my-golfer/0.1 (course import)"}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return json.load(r)

def yd(a, b):
    R = 6371000; la = math.radians((a[0] + b[0]) / 2)
    return math.hypot(math.radians(b[1]-a[1])*math.cos(la)*R, math.radians(b[0]-a[0])*R) * 1.09361

def cen(pts): return [round(sum(p[0] for p in pts)/len(pts), 6), round(sum(p[1] for p in pts)/len(pts), 6)]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("query"); ap.add_argument("--id")
    a = ap.parse_args()
    hits = get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": a.query, "format": "json", "limit": 5}))
    hits = [h for h in hits if h.get("type") == "golf_course"] or hits
    if not hits: sys.exit("No match on OpenStreetMap.")
    h = hits[0]; s, n, w, e = map(float, h["boundingbox"])
    pad = 0.001
    d = get(f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w-pad},{s-pad},{e+pad},{n+pad}")
    els = d["elements"]; nodes = {x["id"]: (x["lat"], x["lon"]) for x in els if x["type"] == "node"}
    greens = [[nodes[i] for i in x["nodes"] if i in nodes] for x in els if x["type"] == "way" and x.get("tags", {}).get("golf") == "green"]
    holes = []
    for x in els:
        t = x.get("tags", {})
        if t.get("golf") != "hole" or "ref" not in t: continue
        pts = [nodes[i] for i in x["nodes"] if i in nodes]
        L = sum(yd(pts[i], pts[i+1]) for i in range(len(pts)-1))
        par = int(t["par"]) if t.get("par", "").isdigit() else (3 if L < 250 else 4 if L < 480 else 5)
        ref = t["ref"]; parts = ref.rsplit(" ", 1)
        nine, num = (parts[0], parts[1]) if len(parts) == 2 and parts[1].isdigit() else (None, ref)
        g = min(greens, key=lambda G: yd(cen(G), pts[-1])) if greens else None
        holes.append({"ref": ref, "nine": nine, "number": int(num) if str(num).isdigit() else num, "par": par,
                      "parInferred": "par" not in t, "yards": round(L),
                      "centerline": [[round(p[0], 6), round(p[1], 6)] for p in pts],
                      "green": {"center": cen(g), "polygon": [[round(p[0], 6), round(p[1], 6)] for p in g]} if g and yd(cen(g), pts[-1]) < 60 else None})
    if not holes: sys.exit(f"Found '{h['display_name']}' but it has no holes mapped in OpenStreetMap. Map them (iD editor) or enter manually.")
    nines = sorted({x["nine"] for x in holes if x["nine"]}) or None
    holes.sort(key=lambda x: ((x["nine"] or ""), x["number"] if isinstance(x["number"], int) else 0))
    course = {"id": a.id or h["name"].lower().replace(" ", "-"), "name": h["name"], "address": h["display_name"],
              "nines": nines, "holes": holes}
    path = pathlib.Path(__file__).resolve().parent.parent / "data" / "courses.json"
    db = json.loads(path.read_text())
    db["courses"] = [c for c in db["courses"] if c["id"] != course["id"]] + [course]
    write_courses(path, db)
    print(f"Saved {course['name']}: {len(holes)} holes, {sum(x['parInferred'] for x in holes)} inferred pars.")

if __name__ == "__main__":
    main()
