"""Export Notion training data to dashboard/data.json.

Only public-safe numeric fields are written: no activity names, notes, URLs or IDs.
Reads the same secrets sync.py uses. Notion stays the source of truth.
"""
import json
import os
import re
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
    "NOTION_ACTIVITIES_DB": ["Date", "Type", "Distance (km)", "Duration (min)", "Elevation (m)", "Avg HR", "Source ID"],
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


# ---- optional exports: Training Plan and Races (property names are auto-detected) ----
def pick(props, kinds, pattern=None, strict=False):
    """First property of the given type(s), preferring names that match pattern."""
    c = [n for n, p in props.items() if p["type"] in kinds]
    if pattern:
        for n in c:
            if re.search(pattern, n, re.I):
                return n
        if strict:
            return None
    return c[0] if c else None


def val_num(p, k):
    x = p.get(k) or {}
    if x.get("type") == "number":
        return x["number"]
    if x.get("type") == "formula" and x["formula"].get("type") == "number":
        return x["formula"]["number"]
    return None


def val_names(p, k):
    x = p.get(k) or {}
    t = x.get("type")
    if t in ("select", "status"):
        return [x[t]["name"]] if x[t] else []
    if t == "multi_select":
        return [o["name"] for o in x["multi_select"]]
    if t == "checkbox":
        return ["Yes"] if x["checkbox"] else []
    return []


def export_plan():
    props = call("GET", f"databases/{os.environ['NOTION_PLAN_DB']}")["properties"]
    m = {"date": pick(props, {"date"}, "date"),
         "type": pick(props, {"select", "multi_select"}, "type|session|workout|category", True),
         "km": pick(props, {"number", "formula"}, "dist|km|mile", True),
         "min": pick(props, {"number", "formula"}, "dur|min|time", True),
         "status": pick(props, {"status", "select"}, "status|state|done", True),
         "key": pick(props, {"select", "multi_select", "checkbox"}, "priority|import|key|optional", True)}
    print(f"Training Plan property mapping: {m}")
    if not m["date"]:
        raise RuntimeError("Training Plan has no date property")
    first = lambda p, k: (val_names(p, k) or [None])[0] if k else None
    rows = []
    for pg in query_all("NOTION_PLAN_DB"):
        p = pg["properties"]
        d = day(p, m["date"])
        if d:
            rows.append({"d": d, "type": first(p, m["type"]),
                         "km": val_num(p, m["km"]) if m["km"] else None,
                         "min": val_num(p, m["min"]) if m["min"] else None,
                         "status": first(p, m["status"]),
                         "key": any("key" in n.lower() or n == "Yes" for n in val_names(p, m["key"]))})
    rows.sort(key=lambda r: r["d"])
    return rows


def export_races():
    props = call("GET", f"databases/{os.environ['NOTION_RACES_DB']}")["properties"]
    title = next(n for n, p in props.items() if p["type"] == "title")
    m = {"date": pick(props, {"date"}, "date"),
         "km": pick(props, {"number", "formula"}, "dist|km", True),
         "elev": pick(props, {"number", "formula"}, "elev|climb|gain", True)}
    print(f"Races property mapping: {m}")
    if not m["date"]:
        raise RuntimeError("Races has no date property")
    rows = []
    for pg in query_all("NOTION_RACES_DB"):
        p = pg["properties"]
        d = day(p, m["date"])
        if d:
            rows.append({"name": "".join(t["plain_text"] for t in p[title]["title"]) or "Race", "d": d,
                         "km": val_num(p, m["km"]) if m["km"] else None,
                         "elev": val_num(p, m["elev"]) if m["elev"] else None})
    rows.sort(key=lambda r: r["d"])
    return rows


def optional_export(env_name, fn):
    if not os.environ.get(env_name):
        print(f"{env_name} not set; skipping")
        return None
    try:
        return fn()
    except Exception as e:
        print(f"Warning: {env_name} export failed: {e}", file=sys.stderr)
        return None


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
                               "elev": num(p, "Elevation (m)"), "hr": num(p, "Avg HR")})

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

    plan = optional_export("NOTION_PLAN_DB", export_plan)
    races = optional_export("NOTION_RACES_DB", export_races)
    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "activities": activities, "gym": gym, "lifts": lifts,
            "plan": plan or [], "races": races or [],
            "has_plan_db": plan is not None, "has_races_db": races is not None}


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
