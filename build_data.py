"""Export Notion training data to dashboard/data.json.

Only public-safe numeric fields are written: no activity names, notes, URLs or IDs.
Reads the same secrets sync.py uses. Notion stays the source of truth.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

HEADERS = {
    "Authorization": f"Bearer {os.environ['NOTION_TOKEN']}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

# Properties this script reads (names taken from sync.py).
EXPECTED = {
    "NOTION_ACTIVITIES_DB": ["Date", "Type", "Distance (km)", "Duration (min)", "Elevation (m)", "Source ID"],
    "NOTION_GYM_DB": ["Date", "Duration (min)", "Volume (kg)", "Sets", "Source ID"],
    "NOTION_LIFTS_DB": ["Date", "Exercise", "Top Set (kg)", "Top Set Reps", "Est. 1RM (kg)", "Volume (kg)", "Source ID"],
}


def call(method, path, **kw):
    for _ in range(5):
        r = requests.request(method, f"https://api.notion.com/v1/{path}", headers=HEADERS, timeout=30, **kw)
        if r.status_code == 429:
            time.sleep(float(r.headers.get("Retry-After", 2)))
            continue
        if not r.ok:
            msg = r.json().get("message", "") if r.headers.get("content-type", "").startswith("application/json") else ""
            raise RuntimeError(f"Notion {r.status_code} on {method} {path.split('/')[0]}: {msg}")
        time.sleep(0.35)
        return r.json()
    raise RuntimeError("Notion rate limit: gave up after retries")


def check_schema(env_name):
    db = call("GET", f"databases/{os.environ[env_name]}")
    missing = [p for p in EXPECTED[env_name] if p not in db["properties"]]
    if missing:
        raise RuntimeError(f"{env_name}: database is missing properties {missing}. "
                           f"Found: {sorted(db['properties'])}")


def query_all(env_name):
    rows, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        data = call("POST", f"databases/{os.environ[env_name]}/query", json=body)
        rows += data["results"]
        if not data["has_more"]:
            return rows
        cursor = data["next_cursor"]


# ---- property readers (all return None when empty) ----
def num(p, k):
    v = p.get(k, {}).get("number")
    return None if v is None else float(v)


def day(p, k):
    d = p.get(k, {}).get("date")
    return d["start"][:10] if d and d.get("start") else None


def sel(p, k):
    s = p.get(k, {}).get("select")
    return s["name"] if s else None


def source_key(page):
    rt = page["properties"].get("Source ID", {}).get("rich_text") or []
    return rt[0]["plain_text"] if rt else page["id"]


def dedupe(pages):
    seen, out = set(), []
    for pg in pages:
        k = source_key(pg)
        if k not in seen:
            seen.add(k)
            out.append(pg)
    return out


def build():
    for name in EXPECTED:
        check_schema(name)

    activities = []
    for pg in dedupe(query_all("NOTION_ACTIVITIES_DB")):
        p = pg["properties"]
        d = day(p, "Date")
        if d:
            activities.append({"d": d, "type": sel(p, "Type") or "Unknown",
                               "km": num(p, "Distance (km)"), "min": num(p, "Duration (min)"),
                               "elev": num(p, "Elevation (m)")})

    gym = []
    for pg in dedupe(query_all("NOTION_GYM_DB")):
        p = pg["properties"]
        d = day(p, "Date")
        if d:
            gym.append({"d": d, "min": num(p, "Duration (min)"),
                        "vol": num(p, "Volume (kg)"), "sets": num(p, "Sets")})

    lifts = []
    for pg in dedupe(query_all("NOTION_LIFTS_DB")):
        p = pg["properties"]
        d, ex = day(p, "Date"), sel(p, "Exercise")
        if d and ex:
            lifts.append({"d": d, "ex": ex, "kg": num(p, "Top Set (kg)"), "reps": num(p, "Top Set Reps"),
                          "e1rm": num(p, "Est. 1RM (kg)"), "vol": num(p, "Volume (kg)")})

    for rows in (activities, gym, lifts):
        rows.sort(key=lambda r: r["d"])

    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "activities": activities, "gym": gym, "lifts": lifts}


if __name__ == "__main__":
    try:
        out = build()
    except Exception as e:
        print(f"Export failed: {e}", file=sys.stderr)
        sys.exit(1)
    os.makedirs("dashboard", exist_ok=True)
    with open("dashboard/data.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"Wrote {len(out['activities'])} activities, {len(out['gym'])} sessions, {len(out['lifts'])} lift rows")
