#!/usr/bin/env python3
"""Print what Polymarket's public Gamma API returns for crypto markets (used to design the parser)."""
import json
import urllib.request

URLS = [
    "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=6&order=volume24hr&ascending=false&tag_slug=crypto",
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=3&order=volume24hr&ascending=false&tag_slug=crypto",
    "https://gamma-api.polymarket.com/tags?limit=200",
]
for u in URLS:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (Ventryx research)", "Accept": "application/json"})
        data = json.loads(urllib.request.urlopen(req, timeout=30).read())
        items = data if isinstance(data, list) else data.get("data", data)
        print(f"== {u}\n   type={type(data).__name__} count={len(items) if hasattr(items, '__len__') else '?'}")
        if "tags" in u:
            print("   crypto-ish tags:", [(t.get("id"), t.get("slug")) for t in items if "crypto" in str(t.get("slug", "")).lower() or "bitcoin" in str(t.get("slug", "")).lower()][:20])
            continue
        for it in (items[:3] if isinstance(items, list) else []):
            short = {k: (v if len(str(v)) < 160 else str(v)[:160] + "...") for k, v in it.items()
                     if k in ("title", "question", "slug", "endDate", "volume", "volume24hr", "liquidity", "outcomes", "outcomePrices", "active", "closed", "tags")}
            print("   ", json.dumps(short)[:900])
            if "markets" in it:
                m0 = it["markets"][0] if it["markets"] else {}
                print("    first market keys:", sorted(m0.keys())[:60])
                print("    first market:", json.dumps({k: m0.get(k) for k in ("question", "slug", "outcomes", "outcomePrices", "volume", "endDate", "groupItemTitle")})[:600])
    except Exception as e:
        print(f"== {u}\n   FAILED: {e}")
