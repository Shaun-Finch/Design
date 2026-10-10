#!/usr/bin/env python3
"""Backtest crypto rotation strategies on daily bars.

Universe: large coins, the main meme coins, and coins that later collapsed (Terra/LUNA, FTT, EOS ...)
so the test isn't only of survivors. A coin is only eligible on a rebalance date once it has enough
history and real trading volume at that time.

Each holding period with equal money in each coin counts as one trade, net of COST_PCT (crypto
spreads and fees are higher than for shares). Every trade is compared with holding the average
eligible coin over the same days ("excess") and with holding Bitcoin. Luck check as for the other
backtests: t-stat of period-average excess >= 2 and positive excess in both halves.

Usage: backtest_crypto.py OUT_DIR   (writes OUT_DIR/backtest-crypto.json)
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

COST_PCT = float(os.environ.get("CRYPTO_COST_PCT") or "0.30")
STAKE = 10.0
MIN_VOL_USD = 20e6

MAJORS = """BTC-USD ETH-USD BNB-USD SOL-USD XRP-USD ADA-USD TRX-USD AVAX-USD DOT-USD LINK-USD BCH-USD LTC-USD
XLM-USD ATOM-USD ETC-USD FIL-USD ICP-USD HBAR-USD NEAR-USD VET-USD ALGO-USD AAVE-USD XMR-USD TON11419-USD
SUI20947-USD APT21794-USD ARB11841-USD OP-USD INJ-USD UNI7083-USD POL28321-USD MATIC-USD""".split()
MEMES = "DOGE-USD SHIB-USD PEPE24478-USD WIF-USD BONK-USD FLOKI-USD".split()
FALLEN = "LUNA1-USD FTT-USD EOS-USD BSV-USD XEM-USD NEO-USD WAVES-USD ZEC-USD DASH-USD XTZ-USD IOTA-USD".split()
UNIVERSE = MAJORS + MEMES + FALLEN


def load():
    import yfinance as yf
    df = yf.download(UNIVERSE, period="8y", interval="1d", group_by="ticker", auto_adjust=True, threads=True, progress=False)
    close, vol = {}, {}
    for t in UNIVERSE:
        try:
            d = df[t].dropna(subset=["Close"])
        except KeyError:
            continue
        if len(d) > 60:
            close[t], vol[t] = d["Close"], d["Close"] * d["Volume"] if "Volume" in d else d["Close"] * 0
    c = pd.DataFrame(close).sort_index()
    v = pd.DataFrame(vol).reindex(c.index)
    print(f"loaded {c.shape[1]} coins: {', '.join(c.columns)}")
    return c, v


def rebalance_dates(idx, every):
    if every == "W":
        return list(idx[idx.dayofweek == 6])  # Sundays (crypto trades every day)
    s = pd.Series(idx, index=idx)
    return list(s.groupby([idx.year, idx.month]).max())


def run(close, vol, lookback, every, top=5, use_filter=False, sma=200, skip=0):
    btc = close["BTC-USD"]
    btc_ok = btc > btc.rolling(sma).mean()
    dates = rebalance_dates(close.index, every)
    trades, periods = [], []
    for a, b in zip(dates[:-1], dates[1:]):
        ia = close.index.get_loc(a)
        if ia < max(lookback + skip, 30) + 1:
            continue
        hist = close.iloc[: ia + 1]
        elig = [t for t in close.columns
                if hist[t].iloc[-(lookback + skip + 1):].notna().all()
                and float(vol[t].iloc[ia - 29: ia + 1].mean()) >= MIN_VOL_USD]
        if len(elig) < top + 3:
            continue
        p0 = close.loc[a, elig]
        p1 = close.loc[b, elig]
        ok = p1.notna()
        avg = float((p1[ok] / p0[ok] - 1).mean() * 100)
        btc_r = float((btc.loc[b] / btc.loc[a] - 1) * 100)
        if use_filter and not bool(btc_ok.loc[a]):
            periods.append({"d": str(b.date()), "cash": True, "n": 0, "pct": 0.0, "exc": 0.0, "btc": btc_r})
            continue
        score = (close.iloc[ia - skip][elig] / close.iloc[ia - skip - lookback][elig] - 1).dropna()
        picks = list(score.sort_values(ascending=False).index[:top])
        rets = []
        for t in picks:
            r1 = close.loc[b, t]
            r = (r1 / close.loc[a, t] - 1) * 100 if np.isfinite(r1) else -100.0  # delisted mid-period: assume lost
            rets.append(r - COST_PCT)
            trades.append({"d": a, "x": b, "t": t, "net": r - COST_PCT, "exc": r - COST_PCT - avg})
        periods.append({"d": str(b.date()), "n": len(rets), "pct": round(sum(rets), 3), "exc": round(sum(rets) - avg * len(rets), 3),
                        "btc": round(btc_r, 3), "picks": picks})
    return trades, periods


def summarise(name, desc, trades, periods):
    if not trades:
        return {"name": name, "desc": desc, "trades": 0}
    df = pd.DataFrame(trades)
    per = df.groupby("d")["exc"].mean()
    t_stat = float(per.mean() / (per.std(ddof=1) / math.sqrt(len(per)))) if len(per) > 2 and per.std() > 0 else 0.0
    mid = df["d"].iloc[0] + (df["d"].iloc[-1] - df["d"].iloc[0]) / 2
    h1, h2 = df[df["d"] < mid], df[df["d"] >= mid]
    # what £10 per coin (reset each period) and the same money in Bitcoin would have made
    btc_gbp = sum(p["btc"] / 100 * STAKE * p["n"] for p in periods if not p.get("cash"))
    cash = sum(1 for p in periods if p.get("cash"))
    eq = np.cumsum([p["pct"] / 100 * STAKE for p in periods])
    dd = float((np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()) if len(eq) else 0.0
    return {
        "name": name, "desc": desc, "trades": int(len(df)), "periods": len(periods), "cashPeriods": cash,
        "from": str(df["d"].iloc[0].date()), "to": str(df["x"].iloc[-1].date()),
        "winRate": round(float((df["net"] > 0).mean() * 100), 1),
        "avgNetPct": round(float(df["net"].mean()), 2), "medianNetPct": round(float(df["net"].median()), 2),
        "avgExcessPct": round(float(df["exc"].mean()), 2),
        "totalGBP": round(float(df["net"].sum() / 100 * STAKE), 2), "sameMoneyInBtcGBP": round(btc_gbp, 2),
        "excessGBP": round(float(df["exc"].sum() / 100 * STAKE), 2), "tStatExcess": round(t_stat, 2),
        "firstHalfExcessGBP": round(float(h1["exc"].sum() / 100 * STAKE), 2),
        "secondHalfExcessGBP": round(float(h2["exc"].sum() / 100 * STAKE), 2),
        "maxDrawdownGBP": round(dd, 2), "worstTradePct": round(float(df["net"].min()), 1),
        "passesLuckCheck": bool(t_stat >= 2 and h1["exc"].sum() > 0 and h2["exc"].sum() > 0),
        "lastPicks": periods[-1].get("picks") if periods else None,
    }


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out_dir, exist_ok=True)
    close, vol = load()
    tests = []
    for every, lbs in (("W", (7, 14, 30, 90)), ("M", (30, 90, 180))):
        for lb in lbs:
            for filt in (False, True):
                name = f"top5_{'weekly' if every == 'W' else 'monthly'}_{lb}d" + ("_btcfilter" if filt else "")
                desc = (f"Every {'week (Sunday)' if every == 'W' else 'month end'}, hold the 5 coins with the biggest {lb}-day rise"
                        + (", in cash while Bitcoin is below its 200-day average" if filt else ""))
                tests.append((name, desc, *run(close, vol, lb, every, use_filter=filt)))
    tests.append(("top5_weekly_30d_btc100", "Weekly, 30-day rise, in cash while Bitcoin is below its 100-day average",
                  *run(close, vol, 30, "W", use_filter=True, sma=100)))
    tests.append(("top3_weekly_30d_btcfilter", "Weekly, top 3 only, 30-day rise, Bitcoin 200-day filter",
                  *run(close, vol, 30, "W", top=3, use_filter=True)))
    results = [summarise(n, d, tr, pe) for n, d, tr, pe in tests]
    btc = close["BTC-USD"].dropna()
    yrs = (btc.index[-1] - btc.index[0]).days / 365.25
    doc = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "costPct": COST_PCT, "stakeGBP": STAKE,
           "coins": list(close.columns), "from": str(close.index[0].date()), "to": str(close.index[-1].date()),
           "btcAnnualPct": round(float(((btc.iloc[-1] / btc.iloc[0]) ** (1 / yrs) - 1) * 100), 1), "variants": results}
    with open(os.path.join(out_dir, "backtest-crypto.json"), "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"{doc['from']} -> {doc['to']}, {len(doc['coins'])} coins, BTC {doc['btcAnnualPct']}%/yr, cost {COST_PCT}%")
    for r in sorted(results, key=lambda r: -(r.get("tStatExcess") or -9)):
        if not r["trades"]:
            print(f"{r['name']:32} no trades")
            continue
        print(f"{r['name']:32} trades {r['trades']:5} cash {r['cashPeriods']:3} win {r['winRate']:5}% avg {r['avgNetPct']:+6.2f}% med {r['medianNetPct']:+6.2f}% "
              f"exc {r['avgExcessPct']:+6.2f}% £{r['totalGBP']:+9.2f} (BTC £{r['sameMoneyInBtcGBP']:+9.2f}) t {r['tStatExcess']:+.2f} "
              f"halves {r['firstHalfExcessGBP']:+.0f}/{r['secondHalfExcessGBP']:+.0f} dd £{r['maxDrawdownGBP']:.0f} worst {r['worstTradePct']}% "
              f"{'PASS' if r['passesLuckCheck'] else 'fail'}")


if __name__ == "__main__":
    main()
