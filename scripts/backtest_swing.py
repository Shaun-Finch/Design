#!/usr/bin/env python3
"""Backtest swing / position strategies on ~10 years of daily bars for the Ventryx universe.

Every trade gets the same money. Results are net of COST_PCT per trade and, because today's
large caps are the survivors of the last decade, every trade is also compared with simply holding
the average stock in the universe over the same days ("excess"). A strategy only shows skill if
its excess is positive, statistically strong (t >= 2 on monthly averages, so overlapping trades
don't inflate it) and positive in both halves of the period.

Usage: backtest_swing.py OUT_DIR   (writes OUT_DIR/backtest-swing.json)
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_markets as bm  # noqa: E402

COST_PCT = float(os.environ.get("COST_PCT") or "0.05")
YEARS = os.environ.get("SWING_YEARS") or "12y"
STAKE = 10.0


def load():
    import yfinance as yf
    tick = list(dict.fromkeys(bm.UNIVERSE + ["SPY"]))
    df = yf.download(tick, period=YEARS, interval="1d", group_by="ticker", auto_adjust=True, threads=True, progress=False)
    close = pd.DataFrame({t: df[t]["Close"] for t in tick if t in df.columns.get_level_values(0)})
    return close.dropna(how="all")


def dip_trades(close, spy_ok, rsi_max=10, max_hold=10, stop_pct=None, use_filter=False, sma_exit=5):
    """Buy at the close when a stock above its 200-day average has a 2-day RSI under rsi_max;
    sell at the first close above its sma_exit-day average, after max_hold days, or at the stop."""
    out = []
    for t in close.columns:
        if t == "SPY":
            continue
        c = close[t].dropna()
        if len(c) < 260:
            continue
        sma200, smax, r2 = c.rolling(200).mean(), c.rolling(sma_exit).mean(), bm.rsi(c, 2)
        cv, s200, sx, rv, idx = c.to_numpy(), sma200.to_numpy(), smax.to_numpy(), r2.to_numpy(), c.index
        i = 200
        while i < len(cv) - 1:
            ok = cv[i] > s200[i] and rv[i] < rsi_max and (not use_filter or bool(spy_ok.get(idx[i], False)))
            if not ok:
                i += 1
                continue
            entry, j = cv[i], i + 1
            while True:
                hit_stop = stop_pct is not None and cv[j] <= entry * (1 - stop_pct / 100)
                if cv[j] > sx[j] or hit_stop or j - i >= max_hold or j == len(cv) - 1:
                    break
                j += 1
            out.append((t, idx[i], idx[j], (cv[j] / entry - 1) * 100))
            i = j + 1
    return out


def momentum_trades(close, spy_ok, top=10, use_filter=False):
    """At each month end hold the top stocks by 12-month return skipping the last month; one trade per stock per month."""
    me = close.resample("ME").last().index
    me = [close.index[close.index <= d][-1] for d in me if (close.index <= d).any()]
    out = []
    for a, b in zip(me[12:-1], me[13:]):
        if use_filter and not spy_ok.get(a, False):
            continue
        ia = close.index.get_loc(a)
        past = close.iloc[ia - 252] if ia >= 252 else None
        if past is None:
            continue
        score = (close.iloc[ia - 21] / past - 1).drop("SPY", errors="ignore").dropna()
        for t in score.sort_values(ascending=False).index[:top]:
            p0, p1 = close.at[a, t], close.at[b, t]
            if np.isfinite(p0) and np.isfinite(p1):
                out.append((t, a, b, (p1 / p0 - 1) * 100))
    return out


def summarise(name, desc, trades, ew):
    """ew: cumulative equal-weight universe index, for the same-days comparison."""
    if not trades:
        return {"name": name, "desc": desc, "trades": 0}
    rows = []
    for t, a, b, r in trades:
        bench = (ew.loc[b] / ew.loc[a] - 1) * 100
        rows.append({"d": a, "x": b, "net": r - COST_PCT, "exc": r - COST_PCT - bench, "days": (b - a).days})
    df = pd.DataFrame(rows).sort_values("d")
    m = df.groupby(df["d"].dt.to_period("M"))["exc"].mean()
    t_stat = float(m.mean() / (m.std(ddof=1) / math.sqrt(len(m)))) if len(m) > 2 and m.std() > 0 else 0.0
    mid = df["d"].iloc[0] + (df["d"].iloc[-1] - df["d"].iloc[0]) / 2
    h1, h2 = df[df["d"] < mid], df[df["d"] >= mid]
    yearly = df.groupby(df["d"].dt.year).agg(n=("net", "size"), gbp=("net", lambda s: s.sum() / 100 * STAKE),
                                              exc=("exc", lambda s: s.sum() / 100 * STAKE))
    return {
        "name": name, "desc": desc, "trades": int(len(df)), "from": str(df["d"].iloc[0].date()), "to": str(df["x"].iloc[-1].date()),
        "winRate": round(float((df["net"] > 0).mean() * 100), 1),
        "avgNetPct": round(float(df["net"].mean()), 3), "avgExcessPct": round(float(df["exc"].mean()), 3),
        "avgDays": round(float(df["days"].mean()), 1),
        "totalGBP": round(float(df["net"].sum() / 100 * STAKE), 2), "excessGBP": round(float(df["exc"].sum() / 100 * STAKE), 2),
        "tStatExcess": round(t_stat, 2),
        "firstHalfExcessGBP": round(float(h1["exc"].sum() / 100 * STAKE), 2),
        "secondHalfExcessGBP": round(float(h2["exc"].sum() / 100 * STAKE), 2),
        "passesLuckCheck": bool(t_stat >= 2 and h1["exc"].sum() > 0 and h2["exc"].sum() > 0),
        "yearly": {str(k): {"n": int(v.n), "gbp": round(float(v.gbp), 2), "excessGBP": round(float(v.exc), 2)} for k, v in yearly.iterrows()},
    }


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out_dir, exist_ok=True)
    close = load()
    spy = close["SPY"]
    spy_ok = (spy > spy.rolling(200).mean()).to_dict()
    rets = close.drop(columns="SPY").pct_change().mean(axis=1).fillna(0)
    ew = (1 + rets).cumprod()
    tests = [
        ("dip_rsi2", "Buy the dip: stock above its 200-day average, 2-day RSI under 10; sell on the first close above the 5-day average or after 10 days", dip_trades(close, spy_ok)),
        ("dip_rsi2_filter", "Same, only while the S&P 500 is above its 200-day average", dip_trades(close, spy_ok, use_filter=True)),
        ("dip_rsi2_deep", "Deeper dips only: 2-day RSI under 5, with the market filter", dip_trades(close, spy_ok, rsi_max=5, use_filter=True)),
        ("dip_rsi2_stop", "Dip rule with the market filter and an 8% stop-loss", dip_trades(close, spy_ok, use_filter=True, stop_pct=8)),
        ("momentum10", "Momentum: each month hold the 10 strongest stocks over the past 12 months (skipping the last month)", momentum_trades(close, spy_ok)),
        ("momentum10_filter", "Momentum, in cash while the S&P 500 is below its 200-day average", momentum_trades(close, spy_ok, use_filter=True)),
        ("momentum5_filter", "Momentum top 5 with the market filter", momentum_trades(close, spy_ok, top=5, use_filter=True)),
    ]
    results = [summarise(n, d, tr, ew) for n, d, tr in tests]
    yrs = (close.index[-1] - close.index[0]).days / 365.25
    doc = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "costPct": COST_PCT, "stakeGBP": STAKE,
           "universe": int(close.shape[1] - 1), "from": str(close.index[0].date()), "to": str(close.index[-1].date()),
           "benchmarks": {"spyAnnualPct": round(float(((spy.iloc[-1] / spy.dropna().iloc[0]) ** (1 / yrs) - 1) * 100), 2),
                          "equalWeightAnnualPct": round(float((ew.iloc[-1] ** (1 / yrs) - 1) * 100), 2)},
           "variants": results}
    with open(os.path.join(out_dir, "backtest-swing.json"), "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"{doc['from']} -> {doc['to']}, {doc['universe']} stocks; SPY {doc['benchmarks']['spyAnnualPct']}%/yr, equal-weight {doc['benchmarks']['equalWeightAnnualPct']}%/yr")
    for r in results:
        if not r["trades"]:
            print(f"{r['name']:18} no trades")
            continue
        print(f"{r['name']:18} trades {r['trades']:5}  win {r['winRate']:5}%  avg {r['avgNetPct']:+.3f}%  excess {r['avgExcessPct']:+.3f}%  "
              f"£{r['totalGBP']:+8.2f} (excess £{r['excessGBP']:+7.2f})  t {r['tStatExcess']:+.2f}  halves {r['firstHalfExcessGBP']:+.2f}/{r['secondHalfExcessGBP']:+.2f}  "
              f"{'PASS' if r['passesLuckCheck'] else 'fail'}")


if __name__ == "__main__":
    main()
