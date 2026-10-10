#!/usr/bin/env python3
"""Backtest opening-bell (opening-range breakout) variants on the last ~60 days of 5-minute bars.

Every variant is judged the same way, with equal money in each trade:
  * net of a cost per trade (COST_PCT, default 0.05% round trip for spread and slippage)
  * long fills at the worse of the entry level and the bar's open (and the mirror for shorts),
    so a gap through the level isn't filled at a price that never traded
  * a stop and a target touched in the same bar count as the stop
  * luck check: t-statistic of the daily results, share of profitable days, and whether the
    first and second half of the period both made money. A real edge should pass all three;
    with ~60 days, anything weaker is indistinguishable from luck.

Usage: backtest_orb.py OUT_DIR   (writes OUT_DIR/backtest.json)
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_markets as bm  # noqa: E402

COST_PCT = float(os.environ.get("COST_PCT") or "0.05")
STAKE = 10.0
ENTRY_DEADLINE = 17  # index of the 10:55 bar: the bot only enters until 11:00 New York
EXIT_BAR = 73        # close of the 15:35 bar = 15:40 New York, when the bot closes everything


def sim(o, h, l, c, side, entry, stop, target, start, deadline, exit_i, gap_fill=True):
    """Return (pct, R) for one trade or None if it never triggered. pct is the % move on the money in."""
    lng = side > 0
    trig = None
    exit_i = min(exit_i, len(c) - 1)
    for i in range(start, exit_i + 1):
        if trig is None:
            if i > deadline:
                return None
            if (lng and h[i] >= entry) or (not lng and l[i] <= entry):
                trig = i
                if gap_fill:
                    entry = max(entry, o[i]) if lng else min(entry, o[i])
            else:
                continue
        if (lng and l[i] <= stop) or (not lng and h[i] >= stop):
            px = stop if (lng and o[i] >= stop) or (not lng and o[i] <= stop) or i == trig else o[i]
            return _res(entry, px, stop, side)
        if target is not None and ((lng and h[i] >= target) or (not lng and l[i] <= target)):
            return _res(entry, target, stop, side)
    if trig is None:
        return None
    return _res(entry, c[exit_i], stop, side)


def _res(entry, px, stop, side):
    pct = (px - entry) / entry * 100 * side
    risk = abs(entry - stop) / entry * 100
    return pct, (pct / risk if risk > 0 else 0.0)


def features(prep, daily):
    """Per session, per ticker: everything known by the end of the opening range."""
    out = {}
    for t, (df, days) in prep.items():
        d_all = daily.get(t)
        if d_all is None:
            continue
        groups = {d: g for d, g in df.groupby("d")}
        for k, day in enumerate(days):
            if k < 2:
                continue
            td = groups[day]
            if len(td) < EXIT_BAR + 1:
                continue  # half days and incomplete sessions
            prev_days = days[max(0, k - 14):k]
            prev_close = float(groups[days[k - 1]]["Close"].iloc[-1])
            d = d_all[d_all.index.date < day]
            if len(d) < 25 or float((d["Close"] * d["Volume"]).tail(20).mean()) < 50e6:
                continue
            o, h, l, c, v = (td[x].to_numpy(dtype=float) for x in ("Open", "High", "Low", "Close", "Volume"))
            or15 = [groups[p]["Volume"].iloc[:3].sum() for p in prev_days[-4:]]
            or5 = [groups[p]["Volume"].iloc[0] for p in prev_days]
            out.setdefault(day, []).append({
                "t": t, "o": o, "h": h, "l": l, "c": c,
                "gap": (o[0] / prev_close - 1) * 100,
                "rv15": v[:3].sum() / np.mean(or15) if or15 and np.mean(or15) > 0 else 1.0,
                "rv5": v[0] / np.mean(or5) if or5 and np.mean(or5) > 0 else 1.0,
                "datr": float(bm.atr(d).iloc[-1]), "sma20": float(d["Close"].tail(20).mean()),
                "a5": float(bm.atr(df.loc[:td.index[2]]).iloc[-1]),
            })
    return out


def orb15(x, stop_mode="mid"):
    orh, orl = x["h"][:3].max(), x["l"][:3].min()
    side = 0
    for i in range(3, len(x["c"])):
        up, dn = x["h"][i] > orh, x["l"][i] < orl
        if up != dn:
            side = 1 if up else -1
            break
    if side == 0:  # no break yet: the scanner still ranks it, leaning with the gap or the day's drift
        side = 1 if (x["gap"] > 0 or x["c"][-1] > (orh + orl) / 2) else -1
    entry = orh if side > 0 else orl
    if stop_mode == "mid":
        risk = max(abs(entry - (orh + orl) / 2), 0.5 * x["a5"])
    else:  # far side of the range
        risk = orh - orl
    stop = entry - side * risk
    return side, entry, stop, entry + side * 2 * risk


def quality(x, side):
    trend_ok = (x["o"][0] > x["sma20"]) == (side > 0)
    return (0.45 * math.tanh(abs(x["gap"]) / 1.5) + 0.35 * max(0.0, math.tanh(math.log(max(x["rv15"], 0.05))))
            + 0.20 * trend_ok + (0.1 if (x["gap"] > 0) == (side > 0) else 0))


def run_variant(feats, name):
    daily = []
    for day in sorted(feats):
        trades = []
        xs = feats[day]
        if name.startswith("orb15"):
            setups = []
            for x in xs:
                width = (x["h"][:3].max() - x["l"][:3].min()) / x["o"][0] * 100
                if width < 0.15 or width > 4:
                    continue
                s = orb15(x, "far" if name == "orb15_widestop" else "mid")
                if s is None:
                    continue
                if name == "orb15_gapdir" and (x["gap"] > 0) != (s[0] > 0):
                    continue
                if name == "orb15_inplay" and (x["rv15"] < 1.5 or abs(x["gap"]) < 1):
                    continue
                setups.append((quality(x, s[0]), x, s))
            setups.sort(key=lambda z: -z[0])
            scanner = name == "orb15_scanner"
            for _, x, (side, entry, stop, target) in setups[:20]:
                r = sim(x["o"], x["h"], x["l"], x["c"], side, entry, stop, target, 3,
                        10 ** 6 if scanner else ENTRY_DEADLINE, len(x["c"]) - 1 if scanner else EXIT_BAR,
                        gap_fill=not scanner)
                if r:
                    trades.append(r)
        else:  # 5-minute ORB on "stocks in play": first candle's direction, stop 10% of daily ATR, hold to 15:40
            top = 10 if name == "orb5_inplay_top10" else 20
            cands = sorted([x for x in xs if x["rv5"] >= 1.0 and x["c"][0] != x["o"][0]], key=lambda x: -x["rv5"])[:top]
            for x in cands:
                side = 1 if x["c"][0] > x["o"][0] else -1
                entry = x["h"][0] if side > 0 else x["l"][0]
                stop = entry - side * 0.10 * x["datr"]
                r = sim(x["o"], x["h"], x["l"], x["c"], side, entry, stop, None, 1, ENTRY_DEADLINE, EXIT_BAR)
                if r:
                    trades.append(r)
        net = [p - COST_PCT for p, _ in trades]
        daily.append({"d": str(day), "n": len(trades), "pct": round(sum(net), 4),
                      "wins": sum(1 for p in net if p > 0), "R": round(sum(r for _, r in trades), 2)})
    return summarise(name, daily)


def summarise(name, daily):
    pnl = np.array([x["pct"] / 100 * STAKE for x in daily])  # £ per day with £10 in every trade
    n = sum(x["n"] for x in daily)
    half = len(daily) // 2
    t = float(pnl.mean() / (pnl.std(ddof=1) / math.sqrt(len(pnl)))) if len(pnl) > 2 and pnl.std() > 0 else 0.0
    eq = np.cumsum(pnl)
    dd = float((np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()) if len(eq) else 0.0
    first, second = float(pnl[:half].sum()), float(pnl[half:].sum())
    return {
        "name": name, "days": len(daily), "trades": n,
        "winRate": round(sum(x["wins"] for x in daily) / n * 100, 1) if n else None,
        "totalGBP": round(float(pnl.sum()), 2), "avgTradeGBP": round(float(pnl.sum()) / n, 4) if n else None,
        "moneyInGBP": n * STAKE, "returnOnMoneyInPct": round(float(pnl.sum()) / (n * STAKE) * 100, 3) if n else None,
        "upDaysPct": round(float((pnl > 0).mean() * 100), 1) if len(pnl) else None,
        "tStat": round(t, 2), "firstHalfGBP": round(first, 2), "secondHalfGBP": round(second, 2),
        "maxDrawdownGBP": round(dd, 2), "totalR": round(sum(x["R"] for x in daily), 1),
        "passesLuckCheck": bool(t >= 2 and first > 0 and second > 0),
        "daily": daily,
    }


VARIANTS = {
    "orb15_scanner": "Ventryx scanner as it runs today: top 20, 15-min range, stop mid-range, target 2x, held to the close",
    "orb15_bot": "Same, with the auto-trader's rules: enter by 11:00, close at 15:40, realistic fills on gaps",
    "orb15_widestop": "Bot rules, stop at the far side of the range instead of the middle",
    "orb15_gapdir": "Bot rules, only trades in the direction of the morning gap",
    "orb15_inplay": "Bot rules, only 'stocks in play': gap of 1%+ and opening volume 1.5x normal or more",
    "orb5_inplay": "5-minute range on the 20 stocks with the heaviest first-5-minute volume vs normal; direction of the first candle; stop 10% of daily ATR; no target, held to 15:40",
    "orb5_inplay_top10": "Same as above, top 10 only",
}


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out_dir, exist_ok=True)
    intra, daily = bm.fetch_prices("60d")
    feats = features(bm.prepare_intraday(intra), daily)
    results = [dict(run_variant(feats, k), desc=v) for k, v in VARIANTS.items()]
    doc = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "costPct": COST_PCT,
           "stakeGBP": STAKE, "universe": len(bm.UNIVERSE), "sessions": len(feats), "variants": results}
    with open(os.path.join(out_dir, "backtest.json"), "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    for r in results:
        print(f"{r['name']:20} trades {r['trades']:5}  £{r['totalGBP']:+8.2f}  win {r['winRate']}%  t {r['tStat']:+.2f}  "
              f"halves £{r['firstHalfGBP']:+.2f}/£{r['secondHalfGBP']:+.2f}  luck-check {'PASS' if r['passesLuckCheck'] else 'fail'}")


if __name__ == "__main__":
    main()
