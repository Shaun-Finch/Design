#!/usr/bin/env python3
"""Build markets.json for Ventryx, the trading-ideas scanner.

Scans a fixed universe of large, liquid US-listed stocks and ranks:

  * Day trading - opening-range breakouts from 5-minute bars. Entry at the
    edge of the first 15 minutes' range, stop at its midpoint, exit target
    at 2x the risk; each setup is tracked through the day (watching, open,
    target hit, stopped, closed at the bell).
  * Long term   - 12-month ideas that combine the published Wall Street
    analyst consensus (rating, number of analysts, mean price target) with
    profitability, growth, trend and volatility.

Market data comes from Yahoo Finance via the yfinance library and may be
delayed. Run by .github/workflows/markets-data.yml; the result is pushed to
the `market-data` branch so frequent refreshes don't clutter `main`.

Usage: build_markets.py OUT_DIR   (reads/writes OUT_DIR/fundamentals.json as a cache)
"""
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd

UNIVERSE = """
AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO BRK-B JPM V MA UNH XOM JNJ PG HD COST LLY ABBV
MRK PEP KO WMT BAC CVX ORCL CRM AMD ADBE NFLX CSCO TMO ACN MCD ABT DHR LIN TXN QCOM
INTU AMGN IBM CAT GE HON UNP LOW SPGI GS MS BLK AXP BKNG ISRG NOW PLD SBUX MDT AMAT
ADI LRCX MU PANW CRWD SNOW SHOP UBER ABNB PYPL PLTR COIN PFE DIS NKE BA F GM INTC T
VZ CMCSA TGT DE DUK SO NEE FSLR ARM DELL DDOG NET ANET KLAC MRVL TSM ASML NVO SONY
""".split()

TOP_N = 20
FUND_MAX_AGE_H = 20


# ---------------------------------------------------------------- indicators
def ema(s, n):
    return s.ewm(span=n, adjust=False).mean()


def rsi(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def atr(df, n=14):
    pc = df["Close"].shift(1)
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - pc).abs(), (df["Low"] - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def fnum(x, nd=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd)


def spark(series, n):
    s = series.dropna()
    if len(s) > n:
        idx = np.linspace(0, len(s) - 1, n).round().astype(int)
        s = s.iloc[idx]
    return [fnum(v, 2) for v in s.tolist()]


# ---------------------------------------------------------------- day trading
# Opening-range breakout (ORB): the first 15 minutes of the session set a
# range. The first side to break it sets the trade: entry at the range edge,
# stop at the range midpoint, exit target at 2x the risk. Every setup is then
# tracked bar by bar so the table shows what actually happened today.
OR_BARS = 3  # 3 x 5-minute bars = 15-minute opening range


def ny_time(ts):
    try:
        return ts.tz_convert("America/New_York").strftime("%H:%M")
    except (AttributeError, TypeError):
        return ts.strftime("%H:%M")


def orb_outcome(after, side, entry, stop, target):
    """Walk the bars after the opening range: trigger, then stop or target (stop wins a tie)."""
    long = side == "long"
    trig = None
    for ts, row in after.iterrows():
        if trig is None:
            if (long and row["High"] >= entry) or (not long and row["Low"] <= entry):
                trig = ts
            else:
                continue
        if (long and row["Low"] <= stop) or (not long and row["High"] >= stop):
            return "stopped", -1.0, trig, ts
        if (long and row["High"] >= target) or (not long and row["Low"] <= target):
            return "target", 2.0, trig, ts
    if trig is None:
        return "watching", None, None, None
    last = float(after["Close"].iloc[-1])
    r = (last - entry) / (entry - stop) if long else (entry - last) / (stop - entry)
    return "open", r, trig, None


def first_break(after, orh, orl):
    for _, row in after.iterrows():
        up, dn = row["High"] > orh, row["Low"] < orl
        if up and not dn:
            return "long"
        if dn and not up:
            return "short"
    return None


def prepare_intraday(intra):
    """Per ticker: the 5-minute bars tagged with their New York session date, and the sessions that have a full opening range."""
    prep = {}
    for t in UNIVERSE:
        try:
            df = intra[t].dropna()
        except KeyError:
            continue
        if len(df) < 60:
            continue
        df = df.copy()
        df["d"] = df.index.tz_convert("America/New_York").date if df.index.tz is not None else df.index.date
        prep[t] = (df, [d for d, g in df.groupby("d") if len(g) > OR_BARS])
    return prep


def day_setups(prep, daily, fund, market_open, session=None):
    """Opening-bell setups for one session (default: the latest). Levels and sizing use only data known by the
    end of the opening range, and nothing about how a trade turned out, so past sessions replay as they ran."""
    rows, sess = [], None
    for t, (df, days) in prep.items():
        today = session or (days[-1] if days else None)
        if today not in days or days.index(today) < 1:
            continue
        td, prev = df[df["d"] == today], df[df["d"] < today]
        sess = str(today)
        orr, after = td.iloc[:OR_BARS], td.iloc[OR_BARS:]
        orh, orl = float(orr["High"].max()), float(orr["Low"].min())
        open_px, price, prev_close = float(td["Open"].iloc[0]), float(td["Close"].iloc[-1]), float(prev["Close"].iloc[-1])
        gap = (open_px / prev_close - 1) * 100
        a5 = float(atr(df.loc[:orr.index[-1]]).iloc[-1]) or open_px * 0.002  # as of the end of the opening range
        width_pct = (orh - orl) / open_px * 100
        if width_pct < 0.15 or width_pct > 4:
            continue  # range too tight to trade or too wide to risk
        d = daily.get(t)
        if d is None:
            continue
        d = d[d.index.date < today]  # daily history up to the previous close
        if len(d) < 25:
            continue
        if float((d["Close"] * d["Volume"]).tail(20).mean()) < 50e6:
            continue
        datr_pct = float(atr(d).iloc[-1] / d["Close"].iloc[-1] * 100)
        sma20 = float(d["Close"].tail(20).mean())
        # opening-range volume vs the same 15 minutes on the previous (up to) 4 sessions
        prior = [g["Volume"].iloc[:OR_BARS].sum() for _, g in prev.groupby("d") if len(g) >= OR_BARS][-4:]
        or_relvol = float(orr["Volume"].sum() / np.mean(prior)) if prior and np.mean(prior) > 0 else 1.0

        side = first_break(after, orh, orl)
        if side is None:  # not broken yet: lean with the gap and the trend
            side = "long" if (gap > 0 or price > (orh + orl) / 2) else "short"
        long = side == "long"
        entry = orh if long else orl
        mid = (orh + orl) / 2
        risk = max(abs(entry - mid), 0.5 * a5)
        stop = entry - risk if long else entry + risk
        target = entry + 2 * risk if long else entry - 2 * risk
        status, r_mult, trig, done = orb_outcome(after, side, entry, stop, target)
        if status == "open" and not (market_open and session is None):
            status = "closed"  # still open at the bell: closed flat at the last price

        trend_ok = (open_px > sma20) == long
        quality = (0.45 * math.tanh(abs(gap) / 1.5) + 0.35 * max(0.0, math.tanh(math.log(max(or_relvol, 0.05))))
                   + 0.20 * (1 if trend_ok else 0) + (0.1 if (gap > 0) == long else 0))
        f = fund.get(t, {})
        rows.append({
            "t": t, "name": f.get("name") or t, "exch": f.get("exch") or "", "mcap": f.get("mcap"),
            "price": fnum(price), "chg": fnum((price / prev_close - 1) * 100), "gap": fnum(gap),
            "side": side, "orh": fnum(orh), "orl": fnum(orl),
            "entry": fnum(entry), "exit": fnum(target), "stop": fnum(stop),
            "gain": fnum(abs(target - entry) / entry * 100), "risk": fnum(abs(entry - stop) / entry * 100), "rr": 2.0,
            "riskLevel": "Low" if datr_pct < 2 else "Medium" if datr_pct < 4 else "High",
            "relvol": fnum(or_relvol), "conf": int(round(min(1.0, quality) * 100)),
            "status": status, "r": fnum(r_mult, 2), "trig": ny_time(trig) if trig is not None else None,
            "done": ny_time(done) if done is not None else None,
            "spark": spark(td["Close"], 40), "_q": quality,
        })
    rows.sort(key=lambda x: -x["_q"])
    rows = rows[:TOP_N]
    for x in rows:
        x.pop("_q")
    card = {"session": sess, "triggered": sum(1 for x in rows if x["status"] != "watching"),
            "targets": sum(1 for x in rows if x["status"] == "target"),
            "stops": sum(1 for x in rows if x["status"] == "stopped"),
            "open": sum(1 for x in rows if x["status"] in ("open", "closed")),
            "watching": sum(1 for x in rows if x["status"] == "watching"),
            "wins": sum(1 for x in rows if x["status"] != "watching" and (x["r"] or 0) > 0),
            # summed % move of every triggered trade: x £ per trade / 100 = profit with that much in each trade
            "pct": fnum(sum((x["r"] or 0) * x["risk"] for x in rows if x["status"] != "watching"), 3),
            "totalR": fnum(sum(x["r"] or 0 for x in rows if x["status"] != "watching"), 2)}
    return rows, card


def update_history(out_dir, prep, daily, fund, market_open):
    """Keep one scorecard per finished session in orb_history.json, so performance can be read over any time frame.
    Sessions already recorded are never recomputed; the first run backfills everything in the intraday window."""
    path = os.path.join(out_dir, "orb_history.json")
    try:
        with open(path) as fh:
            hist = json.load(fh)
    except (OSError, ValueError):
        hist = {}
    sessions = sorted({d for _, days in prep.values() for d in days})
    ny_today = datetime.now(timezone.utc).astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).date()
    added = 0
    for i, sess in enumerate(sessions):
        key = str(sess)
        if (key in hist and "pct" in hist[key]) or i < 2 or (sess == ny_today and market_open):
            continue  # already recorded, too little history before it, or still trading
        _, c = day_setups(prep, daily, fund, False, session=sess)
        if c["session"] is None:
            continue
        hist[key] = {k: c[k] for k in ("triggered", "targets", "stops", "open", "wins", "totalR", "pct")}
        added += 1
    hist = dict(sorted(hist.items())[-400:])
    with open(path, "w") as fh:
        json.dump(hist, fh, separators=(",", ":"))
    print(f"history: {len(hist)} sessions ({added} added)")
    return hist


# ---------------------------------------------------------------- long term
def zscores(vals):
    a = np.array([np.nan if v is None else v for v in vals], dtype=float)
    m, sd = np.nanmean(a), np.nanstd(a)
    z = (a - m) / sd if sd and not math.isnan(sd) else np.zeros_like(a)
    return np.nan_to_num(np.clip(z, -3, 3))


def long_ideas(daily, fund):
    cands = []
    for t in UNIVERSE:
        d, f = daily.get(t), fund.get(t)
        if d is None or len(d) < 200 or not f:
            continue
        c = d["Close"]
        price = float(c.iloc[-1])
        tgt, n_an = f.get("target"), f.get("analysts") or 0
        if not tgt or n_an < 8 or (f.get("netIncome") or 0) <= 0:
            continue
        rets = c.pct_change().dropna()
        cands.append({
            "t": t, "f": f, "price": price, "upside": (tgt / price - 1) * 100,
            "rec": f.get("recMean"), "ret6": (price / float(c.iloc[-126]) - 1) * 100,
            "above200": price > float(c.tail(200).mean()),
            "vol": float(rets.tail(252).std() * math.sqrt(252) * 100),
            "growth": f.get("revGrowth"), "margin": f.get("margin"),
            "hi": float(c.tail(252).max()), "lo": float(c.tail(252).min()), "c": c,
        })
    if not cands:
        return []
    zu = zscores([x["upside"] for x in cands])
    zr = zscores([-(x["rec"] or 3) for x in cands])
    zm = zscores([x["ret6"] for x in cands])
    zg = zscores([x["growth"] for x in cands])
    zp = zscores([x["margin"] for x in cands])
    zv = zscores([x["vol"] for x in cands])
    for i, x in enumerate(cands):
        x["score"] = (0.35 * zu[i] + 0.20 * zr[i] + 0.15 * zm[i] + 0.10 * zg[i]
                      + 0.10 * zp[i] - 0.15 * zv[i] + (0.25 if x["above200"] else -0.25))
    cands.sort(key=lambda x: -x["score"])
    lo_s, hi_s = cands[-1]["score"], cands[0]["score"]
    out = []
    for x in cands[:TOP_N]:
        f = x["f"]
        weekly = x["c"].tail(252).iloc[::5]
        out.append({
            "t": x["t"], "name": f.get("name") or x["t"], "exch": f.get("exch") or "", "sector": f.get("sector") or "",
            "price": fnum(x["price"]), "mcap": f.get("mcap"), "profit": f.get("netIncome"),
            "margin": fnum((f.get("margin") or 0) * 100, 1), "pe": fnum(f.get("pe"), 1),
            "growth": fnum((x["growth"] or 0) * 100, 1) if x["growth"] is not None else None,
            "rating": f.get("recKey"), "recMean": fnum(x["rec"], 2), "analysts": f.get("analysts"),
            "exit": fnum(f.get("target")), "targetLow": fnum(f.get("targetLow")), "targetHigh": fnum(f.get("targetHigh")),
            "upside": fnum(x["upside"], 1), "hi52": fnum(x["hi"]), "lo52": fnum(x["lo"]),
            "vol": fnum(x["vol"], 1), "beta": fnum(f.get("beta"), 2),
            "riskLevel": "Low" if x["vol"] < 25 else "Medium" if x["vol"] < 40 else "High",
            "div": fnum((f.get("divYield") or 0), 2),
            "score": int(round((x["score"] - lo_s) / (hi_s - lo_s) * 100)) if hi_s > lo_s else 50,
            "spark": spark(weekly, 52),
        })
    return out


# ---------------------------------------------------------------- data fetch
def fetch_prices(intra_period="5d"):
    import yfinance as yf
    intra = yf.download(UNIVERSE, period=intra_period, interval="5m", group_by="ticker", auto_adjust=False,
                        prepost=False, threads=True, progress=False)
    daily_all = yf.download(UNIVERSE, period="1y", interval="1d", group_by="ticker", auto_adjust=True,
                            threads=True, progress=False)
    daily = {}
    for t in UNIVERSE:
        try:
            d = daily_all[t].dropna()
            if len(d):
                daily[t] = d
        except KeyError:
            pass
    return intra, daily


def fetch_fundamentals(cache):
    import yfinance as yf
    out = {}
    for t in UNIVERSE:
        for attempt in range(3):
            try:
                i = yf.Ticker(t).info or {}
                out[t] = {
                    "name": i.get("shortName") or i.get("longName"), "exch": i.get("fullExchangeName") or i.get("exchange"),
                    "sector": i.get("sector"), "mcap": i.get("marketCap"), "netIncome": i.get("netIncomeToCommon"),
                    "margin": i.get("profitMargins"), "pe": i.get("trailingPE"), "revGrowth": i.get("revenueGrowth"),
                    "recMean": i.get("recommendationMean"), "recKey": i.get("recommendationKey"),
                    "analysts": i.get("numberOfAnalystOpinions"), "target": i.get("targetMeanPrice"),
                    "targetLow": i.get("targetLowPrice"), "targetHigh": i.get("targetHighPrice"),
                    "divYield": (i.get("trailingAnnualDividendYield") or 0) * 100, "beta": i.get("beta"),
                }
                break
            except Exception as e:  # rate limits: back off, then keep the cached copy
                print(f"info {t} attempt {attempt + 1}: {e}", file=sys.stderr)
                time.sleep(2 + attempt * 3)
        if t not in out and t in cache:
            out[t] = cache[t]
        time.sleep(0.4)
    return out


def _news_items_yf(t):
    import yfinance as yf
    tk = yf.Ticker(t)
    try:
        items = tk.get_news(count=12, tab="news")
    except Exception:
        items = tk.news
    return items or []


def _news_items_rss(t):
    """Yahoo Finance's public RSS headline feed for one ticker."""
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={t}&region=US&lang=en-US"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Ventryx research links)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        root = ET.fromstring(r.read())
    out = []
    for it in root.iter("item"):
        when = it.findtext("pubDate") or ""
        try:
            when = parsedate_to_datetime(when).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            when = ""
        out.append({"title": it.findtext("title") or "", "link": it.findtext("link") or "",
                    "publisher": it.findtext("source") or "Yahoo Finance", "pubDate": when})
    return out


def news_for(t, n=4):
    """Recent articles for a ticker: yfinance first, then Yahoo's RSS headline feed."""
    out, seen, notes = [], set(), []
    for name, fetch in (("yfinance", _news_items_yf), ("rss", _news_items_rss)):
        try:
            items = fetch(t)
        except Exception as e:
            notes.append(f"{name} error {type(e).__name__}: {str(e)[:80]}")
            continue
        notes.append(f"{name} {len(items)}")
        for it in items:
            c = it.get("content") or it
            url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
                   or c.get("link") or "")
            title = (c.get("title") or "").strip()
            if not url.startswith("http") or not title or url in seen:
                continue
            src = (c.get("provider") or {}).get("displayName") or c.get("publisher") or ""
            when = c.get("pubDate") or c.get("displayTime") or ""
            if not when and c.get("providerPublishTime"):
                when = datetime.fromtimestamp(c["providerPublishTime"], timezone.utc).strftime("%Y-%m-%d")
            seen.add(url)
            out.append({"title": title[:180], "src": str(src)[:60], "url": url, "date": str(when)[:10]})
            if len(out) >= n:
                break
        if len(out) >= n:
            break
    print(f"news {t}: {len(out)} kept ({', '.join(notes)})")
    return out


def _txt(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return ""
    return str(x).strip()


def analysts_for(t):
    """Published analyst data for a ticker: rating counts, price-target range and recent rating changes."""
    import yfinance as yf
    tk, out = yf.Ticker(t), {}
    try:
        r = tk.recommendations
        if r is not None and len(r):
            keys = ("strongBuy", "buy", "hold", "sell", "strongSell")
            out["dist"] = {k: int(r.iloc[0].get(k, 0) or 0) for k in keys}
            if len(r) > 1:
                out["distPrev"] = {k: int(r.iloc[1].get(k, 0) or 0) for k in keys}
    except Exception as e:
        print(f"recs {t}: {e}", file=sys.stderr)
    try:
        pt = tk.analyst_price_targets or {}
        if pt:
            out["targets"] = {k: fnum(pt.get(k)) for k in ("low", "mean", "median", "high", "current")}
    except Exception as e:
        print(f"targets {t}: {e}", file=sys.stderr)
    try:
        ud = tk.upgrades_downgrades
        if ud is not None and len(ud):
            ud = ud.sort_index(ascending=False).head(10)
            out["changes"] = [{
                "date": str(idx)[:10], "firm": _txt(row.get("Firm")), "to": _txt(row.get("ToGrade")),
                "from": _txt(row.get("FromGrade")), "action": _txt(row.get("Action")),
                "pt": fnum(row.get("currentPriceTarget")), "ptPrev": fnum(row.get("priorPriceTarget")),
            } for idx, row in ud.iterrows() if _txt(row.get("Firm"))]
    except Exception as e:
        print(f"changes {t}: {e}", file=sys.stderr)
    return out


def research_links(t):
    return {
        "analysts": f"https://finance.yahoo.com/quote/{t}/analysis",
        "news": f"https://finance.yahoo.com/quote/{t}/news",
        "filings": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={t}&type=10-&dateb=&owner=include&count=40",
    }


def market_status(now):
    ny = now.astimezone(__import__("zoneinfo").ZoneInfo("America/New_York"))
    mins = ny.hour * 60 + ny.minute
    open_ = ny.weekday() < 5 and 9 * 60 + 30 <= mins < 16 * 60
    return "open" if open_ else "closed"


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out_dir, exist_ok=True)
    cache_path = os.path.join(out_dir, "fundamentals.json")
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path) as fh:
            cache = json.load(fh)
    now = datetime.now(timezone.utc)
    age_h = (now - datetime.fromisoformat(cache["_at"])).total_seconds() / 3600 if cache.get("_at") else 1e9
    fund = {k: v for k, v in cache.items() if not k.startswith("_")}
    if age_h > FUND_MAX_AGE_H or os.environ.get("REFRESH_FUNDAMENTALS"):
        fund = fetch_fundamentals(fund)
        with open(cache_path, "w") as fh:
            json.dump({"_at": now.isoformat(), **fund}, fh, separators=(",", ":"))
    try:  # rebuild from 60 days of bars on the first run, or when older entries lack a newer field
        with open(os.path.join(out_dir, "orb_history.json")) as fh:
            backfill = any("pct" not in v for v in json.load(fh).values())
    except (OSError, ValueError):
        backfill = True
    backfill = backfill or bool(os.environ.get("BACKFILL_HISTORY"))
    intra, daily = fetch_prices("60d" if backfill else "5d")  # Yahoo keeps about 60 days of 5-minute bars
    status = market_status(now)
    prep = prepare_intraday(intra)
    day, card = day_setups(prep, daily, fund, status == "open")
    try:
        hist = update_history(out_dir, prep, daily, fund, status == "open")
    except Exception as e:  # history is a nice-to-have: never block the live scan
        print(f"history update failed: {e}", file=sys.stderr)
        hist = {}
    lng = long_ideas(daily, fund)
    for x in lng:
        x["news"] = news_for(x["t"])
        x["an"] = analysts_for(x["t"])
        x["links"] = research_links(x["t"])
        time.sleep(0.3)
    if len(day) < 5 and len(lng) < 5:
        sys.exit("too few results; keeping the previous file")
    doc = {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "market": status, "scorecard": card,
        "universe": len(UNIVERSE), "scanned": len(daily),
        "breadth": fnum(sum(1 for t, d in daily.items() if len(d) >= 200 and d["Close"].iloc[-1] > d["Close"].tail(200).mean()) / max(1, len(daily)) * 100, 0),
        "source": "Yahoo Finance via yfinance (may be delayed)",
        "day": day, "long": lng,
        "history": [{"d": k, **v} for k, v in hist.items()],
    }
    with open(os.path.join(out_dir, "markets.json"), "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"wrote {len(day)} day setups, {len(lng)} long-term ideas from {len(daily)} stocks")


if __name__ == "__main__":
    main()
