"""Polite, cached HTTP for the OpenStreetMap import scripts.

- Real User-Agent, at most ~1 request/second per host, backs off on 429/5xx.
- Raw responses are cached under scripts/.osm_cache/ (gitignored) keyed by the request,
  so re-running an import doesn't refetch anything. Delete the dir to pull fresh data.
"""
from __future__ import annotations
import hashlib, json, pathlib, time, urllib.error, urllib.parse, urllib.request

UA = {"User-Agent": "find-my-golfer/0.1 (course import; github.com/mrjosephsimms/FindMyGolfer)"}
CACHE = pathlib.Path(__file__).resolve().parent / ".osm_cache"
OVERPASS = "https://overpass-api.de/api/interpreter"
MIN_GAP = 1.1  # seconds between requests to the same host
_last: dict[str, float] = {}


def _cache_path(key: str) -> pathlib.Path:
    return CACHE / (hashlib.sha1(key.encode()).hexdigest() + ".json")


def _fetch(url: str, data: bytes | None, timeout: int, attempts: int = 10) -> dict:
    host = urllib.parse.urlparse(url).netloc
    for attempt in range(attempts):
        wait = _last.get(host, 0) + MIN_GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                back = min(60, 3 * 2 ** attempt)
                print(f"  HTTP {e.code} from {host}; backing off {back}s", flush=True)
                time.sleep(back)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < attempts - 1:
                back = min(60, 3 * 2 ** attempt)
                print(f"  {e} from {host}; retrying in {back}s", flush=True)
                time.sleep(back)
                continue
            raise
    raise RuntimeError("unreachable")


def get_json(url: str, timeout: int = 120) -> dict:
    p = _cache_path(url)
    if p.exists():
        return json.loads(p.read_text())
    d = _fetch(url, None, timeout)
    CACHE.mkdir(exist_ok=True)
    p.write_text(json.dumps(d))
    return d


def overpass(query: str, timeout: int = 300, attempts: int = 10) -> dict:
    """Run an Overpass QL query (cached). Use `out body; >; out skel qt;` to get the same
    node/way element shape as the OSM map API."""
    p = _cache_path("overpass:" + query)
    if p.exists():
        return json.loads(p.read_text())
    d = _fetch(OVERPASS, urllib.parse.urlencode({"data": query}).encode(), timeout, attempts)
    if d.get("remark") and "error" in d["remark"].lower():
        raise RuntimeError(f"Overpass: {d['remark']}")
    CACHE.mkdir(exist_ok=True)
    p.write_text(json.dumps(d))
    return d


def write_courses(path, db):
    """Write data/courses.json one course per line, compact JSON: small and diff-friendly."""
    lines = [json.dumps(c, separators=(",", ":"), ensure_ascii=False) for c in db["courses"]]
    head = json.dumps({k: v for k, v in db.items() if k != "courses"}, ensure_ascii=False)[:-1]
    path.write_text(head + ',"courses":[\n' + ",\n".join(lines) + "\n]}\n")
