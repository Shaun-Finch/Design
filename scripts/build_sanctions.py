#!/usr/bin/env python3
"""Build data/sanctions.json for Xovern's Screening plug-in.

Downloads the two official public lists and reduces them to names, aliases,
type and regime so the browser can screen against them:

  * UK Sanctions List (FCDO) - the only UK designation source since
    28 January 2026. Open Government Licence v3.0.
  * OFAC Specially Designated Nationals (SDN) list - U.S. Treasury, public domain.

Run by .github/workflows/sanctions-data.yml every day. Exits non-zero, and
leaves the existing file alone, if a download or parse fails.
"""
import csv
import io
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

UK_URLS = ["https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv"]
OFAC_BASES = [
    "https://sanctionslistservice.ofac.treas.gov/api/download/",
    "https://www.treasury.gov/ofac/downloads/",
]
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "sanctions.json")
UA = "Xovern-sanctions-sync/1.0 (+https://github.com/Shaun-Finch/Design)"


def fetch(urls):
    last = None
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) < 1000:
                raise ValueError(f"{url}: response too small ({len(data)} bytes)")
            print(f"fetched {url} ({len(data):,} bytes)")
            return data
        except Exception as e:  # try the next mirror
            print(f"failed {url}: {e}", file=sys.stderr)
            last = e
    raise RuntimeError(f"all sources failed: {last}")


def decode(raw):
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def clean(s):
    s = (s or "").strip()
    return "" if s in ("-0-", "-0- ") else " ".join(s.split())


def parse_uk(text):
    rows = list(csv.reader(io.StringIO(text)))
    head_ix = next(
        (i for i, r in enumerate(rows[:20]) if "Unique ID" in [c.strip() for c in r] and "Name 6" in [c.strip() for c in r]),
        None,
    )
    if head_ix is None:
        raise ValueError("UK list: header row with 'Unique ID' and 'Name 6' not found")
    head = [c.strip() for c in rows[head_ix]]
    col = {name: i for i, name in enumerate(head)}

    def get(r, name):
        i = col.get(name)
        return clean(r[i]) if i is not None and i < len(r) else ""

    recs = {}
    for r in rows[head_ix + 1:]:
        uid = get(r, "Unique ID")
        if not uid:
            continue
        parts = [get(r, f"Name {n}") for n in range(1, 6)]
        name = " ".join(p for p in parts + [get(r, "Name 6")] if p)
        if not name:
            continue
        rec = recs.setdefault(uid, {"names": [], "primary": None, "type": get(r, "Designation Type"), "regime": get(r, "Regime Name")})
        if get(r, "Name type").lower().startswith("primary") and not rec["primary"]:
            rec["primary"] = name
        if name not in rec["names"]:
            rec["names"].append(name)
    out = []
    for uid, rec in recs.items():
        names = rec["names"]
        if rec["primary"]:
            names = [rec["primary"]] + [n for n in names if n != rec["primary"]]
        out.append(["uk", uid, rec["type"] or "Unknown", rec["regime"], names[:12]])
    if len(out) < 1000:
        raise ValueError(f"UK list: only {len(out)} designations parsed, expected thousands")
    return out


def parse_ofac(sdn_text, alt_text):
    recs = {}
    for r in csv.reader(io.StringIO(sdn_text)):
        if len(r) < 4 or not r[0].strip().isdigit():
            continue
        ent, name, typ, prog = r[0].strip(), clean(r[1]), clean(r[2]), clean(r[3])
        if not name:
            continue
        recs[ent] = ["ofac", ent, (typ or "entity").capitalize(), prog, [name]]
    for r in csv.reader(io.StringIO(alt_text)):
        if len(r) < 4 or not r[0].strip().isdigit():
            continue
        ent, alt = r[0].strip(), clean(r[3])
        if ent in recs and alt and alt not in recs[ent][4] and len(recs[ent][4]) < 12:
            recs[ent][4].append(alt)
    out = list(recs.values())
    if len(out) < 1000:
        raise ValueError(f"OFAC: only {len(out)} entries parsed, expected thousands")
    return out


def ofac_urls(name):
    return [b + name for b in OFAC_BASES] + [b + name.upper() for b in OFAC_BASES[:1]]


def main():
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    uk = parse_uk(decode(fetch(UK_URLS)))
    ofac = parse_ofac(decode(fetch(ofac_urls("sdn.csv"))), decode(fetch(ofac_urls("alt.csv"))))
    doc = {
        "generated": now,
        "sources": [
            {"id": "uk", "name": "UK Sanctions List (FCDO)", "count": len(uk), "licence": "Open Government Licence v3.0",
             "home": "https://www.gov.uk/government/publications/the-uk-sanctions-list"},
            {"id": "ofac", "name": "OFAC SDN List (U.S. Treasury)", "count": len(ofac), "licence": "Public domain (U.S. Government work)",
             "home": "https://ofac.treasury.gov/sanctions-list-service"},
        ],
        "fields": ["list", "id", "type", "regime", "names"],
        "records": uk + ofac,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"wrote {OUT}: {len(uk):,} UK designations, {len(ofac):,} OFAC entries")


if __name__ == "__main__":
    main()
