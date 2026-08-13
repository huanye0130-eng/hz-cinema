#!/usr/bin/env python3
"""Build a self-contained static site: dist/index.html with embedded data.

The original frontend calls /api/* endpoints served by server.py.
This script embeds data/hz_cinema.json into the HTML and shims those
API calls with client-side logic, so the result runs on any static host
(or even directly from a phone file manager).
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / "data" / "hz_cinema.json").read_text(encoding="utf-8"))
SHOW_PATH = ROOT / "data" / "showtimes.json"

HALL_RANK = {
    "IMAX激光": 0,
    "IMAX": 1,
    "杜比影院": 2,
    "CINITY": 3,
    "杜比全景声": 4,
    "杜比巨幕": 5,
    "激光巨幕": 6,
    "中国巨幕": 7,
    "LUXE": 8,
    "4DX": 9,
    "激光厅": 10,
    "杜比": 11,
    "标准厅": 12,
}

SUMMARY_TYPES = {
    "IMAX": ["IMAX", "IMAX激光"],
    "杜比": ["杜比影院", "杜比巨幕", "杜比全景声"],
    "CINITY": ["CINITY"],
    "激光巨幕": ["激光巨幕", "中国巨幕", "杜比巨幕"],
}


def build_summary(cinemas):
    out = {}
    for label, types in SUMMARY_TYPES.items():
        seen = set()
        items = []
        for c in cinemas:
            for h in c["halls"]:
                if h["special_type"] not in types:
                    continue
                key = (c["name"], h["special_type"], h["hall_name"])
                if key in seen:
                    continue
                seen.add(key)
                items.append(
                    {
                        "name": c["name"],
                        "district": c["district"],
                        "hall_name": h["hall_name"],
                        "special_type": h["special_type"],
                        "screen_width_m": h.get("screen_width_m"),
                        "screen_height_m": h.get("screen_height_m"),
                    }
                )
        out[label] = items
    return out


# Precompute list payloads (id is the index in the cinemas array).
def cinema_list_item(cid, c):
    special_types = sorted({h["special_type"] for h in c["halls"]})
    return {
        "id": cid,
        "name": c["name"],
        "district": c["district"],
        "address": c["address"],
        "source": c["source"],
        "hall_count": len(c["halls"]),
        "special_types": ",".join(special_types),
        "seed_halls": sum(1 for h in c["halls"] if h["source"] == "special_seed"),
    }


def hall_sort_key(h):
    return (
        0 if h["source"] == "special_seed" else 1,
        1 if h["special_type"] == "标准厅" else 0,
        h["hall_name"],
    )


def norm_name(name):
    import re
    return re.sub(r"[\s（）()·\-—]", "", name or "")


def hall_rank(special_type):
    return HALL_RANK.get(special_type, 13)


def build_showtimes():
    """Precompute per-movie cinema schedules, ranked by special-hall quality."""
    if not SHOW_PATH.exists():
        return {"movies": [], "byMovie": {}}
    raw = json.loads(SHOW_PATH.read_text(encoding="utf-8"))
    cinemas = raw.get("cinemas", {})
    hall_maps = raw.get("hall_maps", {})
    district_of = {norm_name(c["name"]): c["district"] for c in DATA["cinemas"]}

    movies = {}
    for cname, cd in cinemas.items():
        for mid, m in cd.get("movies", {}).items():
            entry = movies.setdefault(
                mid,
                {
                    "id": mid,
                    "nm": m["nm"],
                    "sc": m.get("sc") or 0,
                    "dur": m.get("dur") or "",
                    "cc": 0,
                    "cinemas": {},
                },
            )
            entry["cc"] += 1
            entry["cinemas"][cname] = m.get("dates", {})

    movie_list = sorted(
        ({"id": e["id"], "nm": e["nm"], "sc": e["sc"], "dur": e["dur"], "cc": e["cc"]}
         for e in movies.values()),
        key=lambda x: -x["cc"],
    )

    by_movie = {}
    for mid, entry in movies.items():
        dates = sorted({d for cdates in entry["cinemas"].values() for d in cdates})
        rows = []
        for cname, cdates in entry["cinemas"].items():
            hm = hall_maps.get(cname, {})
            shows_by_date = {}
            hall_spec = {}
            for date, sessions in cdates.items():
                cleaned = []
                for s in sessions:
                    if not s or not s[0]:
                        continue
                    spec = hm.get(s[1])
                    if spec and s[1] not in hall_spec:
                        hall_spec[s[1]] = spec
                    cleaned.append(s)
                if cleaned:
                    shows_by_date[date] = cleaned
            if not shows_by_date:
                continue
            used_halls = {s[1] for ss in shows_by_date.values() for s in ss}
            specs = [hm.get(h) for h in used_halls if hm.get(h)]
            best_rank = min(hall_rank(x) for x in specs) if specs else 13
            best_type = specs[specs.index(min(specs, key=hall_rank))] if specs else ""
            rows.append(
                {
                    "n": cname,
                    "d": district_of.get(norm_name(cname), ""),
                    "r": best_rank,
                    "bt": best_type,
                    "hs": hall_spec,
                    "s": shows_by_date,
                }
            )
        rows.sort(key=lambda x: (x["r"], x["n"]))
        by_movie[mid] = {"dates": dates, "cinemas": rows}
    return {"movies": movie_list, "byMovie": by_movie}


def main():
    cinemas = DATA["cinemas"]
    districts = {}
    for c in cinemas:
        districts[c["district"]] = districts.get(c["district"], 0) + 1
    district_list = sorted(
        ({"district": k, "cinema_count": v} for k, v in districts.items()),
        key=lambda d: -d["cinema_count"],
    )

    special_types = {}
    for c in cinemas:
        for h in c["halls"]:
            t = h["special_type"]
            special_types[t] = special_types.get(t, 0) + 1
    special_list = sorted(
        ({"special_type": k, "hall_count": v} for k, v in special_types.items()),
        key=lambda d: -d["hall_count"],
    )

    showtimes = build_showtimes()
    import datetime as _dt
    precomputed = {
        "buildTime": _dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "districts": district_list,
        "specialTypes": special_list,
        "summary": build_summary(cinemas),
        "cinemas": [cinema_list_item(i, c) for i, c in enumerate(cinemas)],
        "details": [
            {
                "cinema": {
                    "id": i,
                    "name": c["name"],
                    "district": c["district"],
                    "address": c["address"],
                    "source": c["source"],
                },
                "halls": sorted(c["halls"], key=hall_sort_key),
            }
            for i, c in enumerate(cinemas)
        ],
        "movies": showtimes["movies"],
        "showtimes": showtimes["byMovie"],
    }
    payload = json.dumps(precomputed, ensure_ascii=False, separators=(",", ":"))

    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    css = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    # Strip the original fetch-based getJson so the embedded shim is the
    # only definition (duplicate function declarations -> last one wins).
    js = js.replace(
        "async function getJson(url) {\n"
        "  const response = await fetch(url);\n"
        "  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n"
        "  return response.json();\n"
        "}\n",
        "",
    )

    # Client-side shim: replace fetch-based getJson with in-memory lookups.
    shim = f"""
const __DATA = {payload};
async function getJson(url) {{
  const clean = url.split("?")[0];
  if (clean === "/api/districts") return __DATA.districts;
  if (clean === "/api/special-types") return __DATA.specialTypes;
  if (clean === "/api/summary") return __DATA.summary;
  if (clean === "/api/cinemas") {{
    const params = new URLSearchParams(url.split("?")[1] || "");
    const district = params.get("district") || "";
    const special = params.get("special") || "";
    const q = (params.get("q") || "").trim();
    let rows = __DATA.cinemas;
    if (district) rows = rows.filter((r) => r.district === district);
    if (special) rows = rows.filter((r) => (r.special_types || "").split(",").includes(special));
    if (q) rows = rows.filter((r) => r.name.includes(q) || r.address.includes(q));
    return rows.slice().sort((a, b) =>
      a.district.localeCompare(b.district) || b.seed_halls - a.seed_halls || a.name.localeCompare(b.name)
    );
  }}
  if (clean === "/api/movies") return __DATA.movies;
  if (clean === "/api/showtimes") {{
    const params = new URLSearchParams(url.split("?")[1] || "");
    const movieId = params.get("movie") || "";
    return __DATA.showtimes[movieId] || {{ dates: [], cinemas: [] }};
  }}
  const m = clean.match(/^\\/api\\/cinemas\\/(\\d+)$/);
  if (m) return __DATA.details[Number(m[1])] || {{ error: "not found" }};
  throw new Error("HTTP 404");
}}
"""

    # Guard: app.js must not define its own getJson after the strip,
    # otherwise it would override the embedded shim (previous live bug).
    if "function getJson" in js:
        raise SystemExit(
            "ERROR: static/app.js still defines getJson; "
            "the embedded data shim would be overridden."
        )

    static_js = shim + "\n" + js
    build_time = precomputed["buildTime"]
    html = html.replace(
        '<span id="buildStamp" title="构建时间">—</span>',
        f'<span id="buildStamp" title="构建时间">构建 {build_time}</span>',
    )
    out_html = (
        html.replace('<link rel="stylesheet" href="/styles.css">', f"<style>\n{css}\n</style>")
        .replace('<script src="/app.js"></script>', f"<script>\n{static_js}\n</script>")
    )

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "index.html").write_text(out_html, encoding="utf-8")
    size = (dist / "index.html").stat().st_size
    print(f"dist/index.html written: {size / 1024:.0f} KB")
    print(f"cinemas={len(cinemas)} halls={sum(len(c['halls']) for c in cinemas)}")


if __name__ == "__main__":
    main()
