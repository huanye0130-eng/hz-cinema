#!/usr/bin/env python3
"""Scrape Maoyan showtimes for all Hangzhou cinemas (cityId=50).

- cinemaList: paginated list of cinemas in city
- cinemaDetail: per-cinema movies + per-day sessions (hall, time, lang, price)

Output: data/showtimes.json (compact, grouped by cinema -> movie -> date)
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import urllib.request

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "hz_cinema.sqlite"
OUT_PATH = DATA_DIR / "showtimes.json"

UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)
CITY_ID = 50
PAGE_SIZE = 50
MAX_WORKERS = 5
DELAY = 0.25


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def norm_name(name: str) -> str:
    return re.sub(r"[\s（）()·\-—]", "", name or "")


def load_db_halls() -> dict[str, dict[str, str]]:
    """cinema_name_norm -> {hall_name: special_type}"""
    out: dict[str, dict[str, str]] = {}
    if not DB_PATH.exists():
        return out
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        """
        SELECT c.name AS cinema, h.hall_name, h.special_type
        FROM halls h JOIN cinemas c ON c.id = h.cinema_id
        """
    ).fetchall()
    conn.close()
    for cinema, hall, stype in rows:
        out.setdefault(norm_name(cinema), {})[hall] = stype
    return out


def classify_hall(hall_name: str) -> str | None:
    h = (hall_name or "").upper()
    if "IMAX" in h:
        return "IMAX激光" if "激光" in h else "IMAX"
    if "杜比" in hall_name:
        if "全景声" in hall_name:
            return "杜比全景声"
        return "杜比影院" if "影院" in hall_name else "杜比"
    if "CINITY" in h:
        return "CINITY"
    if "巨幕" in hall_name:
        return "激光巨幕" if "激光" in hall_name else "中国巨幕"
    if "LUXE" in h:
        return "LUXE"
    if "4DX" in h:
        return "4DX"
    if "激光" in hall_name:
        return "激光厅"
    return None


def scrape_cinema(item: dict, db_halls: dict[str, dict[str, str]]) -> tuple[dict, dict]:
    cid = item["id"]
    name = item["nm"]
    detail = fetch_json(f"https://i.maoyan.com/ajax/cinemaDetail?cinemaId={cid}")
    movies = {}
    hall_map: dict[str, str | None] = {}
    db_map = db_halls.get(norm_name(name), {})
    for movie in detail.get("showData", {}).get("movies", []):
        mid = movie["id"]
        by_date: dict[str, list[list[str]]] = {}
        for day in movie.get("shows", []):
            if not day.get("hasShow"):
                continue
            date = day["showDate"]
            sessions = []
            for p in day.get("plist", []):
                hall = p.get("th", "")
                if hall not in hall_map:
                    special = db_map.get(hall) or classify_hall(hall)
                    hall_map[hall] = special
                price = p.get("vipPrice") or ""
                if isinstance(price, str) and re.fullmatch(r"[\d.]+", price):
                    price_s = price
                else:
                    price_s = ""
                sessions.append([p.get("tm", ""), hall, p.get("tp", ""), p.get("lang", ""), price_s])
            if sessions:
                by_date[date] = sessions
        if by_date:
            movies[str(mid)] = {
                "nm": movie["nm"],
                "sc": movie.get("sc", ""),
                "dur": movie.get("dur", ""),
                "dates": by_date,
            }
    time.sleep(DELAY)
    return {"id": cid, "nm": name, "addr": item.get("addr", ""), "movies": movies}, hall_map


def main() -> None:
    cinemas: list[dict] = []
    offset = 0
    while True:
        page = fetch_json(
            f"https://i.maoyan.com/ajax/cinemaList?cityId={CITY_ID}&offset={offset}&limit={PAGE_SIZE}"
        )
        cinemas.extend(page.get("cinemas", []))
        paging = page.get("paging", {})
        offset += PAGE_SIZE
        if not paging.get("hasMore"):
            break
    print(f"cinemas to scrape: {len(cinemas)}")

    db_halls = load_db_halls()
    results: dict[str, dict] = {}
    hall_maps: dict[str, dict[str, str | None]] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(scrape_cinema, c, db_halls): c for c in cinemas}
        done = 0
        for fut in as_completed(futures):
            try:
                data, hall_map = fut.result()
                results[data["nm"]] = data
                hall_maps[data["nm"]] = hall_map
            except Exception as exc:  # noqa: BLE001 - keep going on per-cinema failure
                name = futures[fut]["nm"]
                print(f"FAIL {name}: {exc}")
            done += 1
            if done % 20 == 0:
                print(f"progress {done}/{len(cinemas)}")

    payload = {
        "meta": {
            "city": "杭州",
            "city_id": CITY_ID,
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "cinema_count": len(results),
            "source": "猫眼 i.maoyan.com cinemaList+cinemaDetail",
        },
        "cinemas": results,
        "hall_maps": hall_maps,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"written {OUT_PATH} size={OUT_PATH.stat().st_size / 1024:.0f} KB, cinemas={len(results)}")


if __name__ == "__main__":
    main()
