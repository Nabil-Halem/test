#!/usr/bin/env python3
"""Chart read: what a chart analyst writes, computed from daily candles.

    python3 trader/chart_read.py AAPL AXP GOOGL KO BAC BTC-USD --write
    python3 trader/chart_read.py AAPL --horizon 10

For each symbol it reads five years of daily candles from Yahoo's chart
endpoint and writes the read an analyst would: trend (price against the 50-
and 200-day averages), momentum (RSI, MACD, recent returns), the nearest
support and resistance, volatility, a few named patterns, a checklist that
adds up to a lean (bullish, neutral or bearish), and a bear / base / bull range
for the horizon from the stock's own volatility.

Two things an analyst usually leaves out, which this adds:
  - the base rate: how often, in the past five years, the same setup was
    followed by a higher price after the horizon, and the typical move;
  - the score: every read is logged with a target date, and on later runs
    the resolved ones are checked against what actually happened.

It describes the chart and quotes history. It does not know the future, and a
lean is not a recommendation. Standard library only. Not financial advice.
"""
import argparse
import datetime
import json
import math
import os
import statistics
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "chart_read.json")
LOG = os.path.join(HERE, "state", "chart_log.json")
RAW = os.path.join(HERE, "state", "raw")
URL = "https://query1.finance.yahoo.com/v8/finance/chart/%s?range=5y&interval=1d"
UA = "Mozilla/5.0 (trader-skill chart_read; +https://github.com/Jakeschincariol/trader-skill)"


def fetch(symbol):
    req = urllib.request.Request(URL % symbol, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError("HTTP %s for %s" % (exc.code, symbol))
    except urllib.error.URLError as exc:
        raise RuntimeError("could not reach query1.finance.yahoo.com: %s" % exc.reason)
    res = data["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    bars = []
    for i, ts in enumerate(res["timestamp"]):
        if q["close"][i] is None or q["high"][i] is None or q["low"][i] is None:
            continue
        bars.append({"date": datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).date().isoformat(),
                     "open": q["open"][i], "high": q["high"][i], "low": q["low"][i], "close": q["close"][i], "volume": q["volume"][i] or 0})
    meta = res["meta"]
    return bars, meta


def sma(xs, n):
    out = [None] * len(xs)
    s = 0.0
    for i, x in enumerate(xs):
        s += x
        if i >= n:
            s -= xs[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def ema(xs, n):
    out = [None] * len(xs)
    k = 2.0 / (n + 1)
    e = None
    for i, x in enumerate(xs):
        e = x if e is None else x * k + e * (1 - k)
        if i >= n - 1:
            out[i] = e
    return out


def rsi(xs, n=14):
    out = [None] * len(xs)
    gain = loss = None
    for i in range(1, len(xs)):
        d = xs[i] - xs[i - 1]
        g, l = max(d, 0.0), max(-d, 0.0)
        if i <= n:
            gain = (gain or 0) + g / n
            loss = (loss or 0) + l / n
            if i == n:
                out[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
        else:
            gain = (gain * (n - 1) + g) / n
            loss = (loss * (n - 1) + l) / n
            out[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return out


def atr(bars, n=14):
    trs = []
    for i, b in enumerate(bars):
        prev = bars[i - 1]["close"] if i else b["close"]
        trs.append(max(b["high"] - b["low"], abs(b["high"] - prev), abs(b["low"] - prev)))
    return ema(trs, n)


def pct(a, b):
    return (a / b - 1) * 100 if a is not None and b else None


def r2(x, d=2):
    return None if x is None else round(x, d)


def swing_levels(bars, close, window=5, lookback=120):
    hs, ls = [], []
    seg = bars[-lookback:]
    for i in range(window, len(seg) - window):
        hi = seg[i]["high"]; lo = seg[i]["low"]
        if all(hi >= seg[j]["high"] for j in range(i - window, i + window + 1)):
            hs.append(hi)
        if all(lo <= seg[j]["low"] for j in range(i - window, i + window + 1)):
            ls.append(lo)
    support = max([l for l in ls if l < close], default=None)
    resistance = min([h for h in hs if h > close], default=None)
    return support, resistance


def forward_returns(closes, h):
    return [closes[i + h] / closes[i] - 1 for i in range(len(closes) - h)]


def setup_key(close, s200, r, macd, sig):
    if None in (close, s200, r, macd, sig):
        return None
    zone = "low" if r < 40 else "high" if r > 60 else "mid"
    return "%s 200-day, RSI %s, MACD %s" % ("above" if close > s200 else "below", zone, "up" if macd > sig else "down")


def quantile(xs, q):
    if not xs:
        return None
    s = sorted(xs)
    pos = (len(s) - 1) * q
    lo, hi = int(math.floor(pos)), int(math.ceil(pos))
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def read_symbol(symbol, bars, meta, horizon, today):
    if bars and bars[-1]["date"] >= today:
        bars = bars[:-1]  # today's bar is still being written
    if len(bars) < 260:
        raise RuntimeError("only %d daily bars for %s; need a year" % (len(bars), symbol))
    c = [b["close"] for b in bars]
    n = len(c)
    s20, s50, s200 = sma(c, 20), sma(c, 50), sma(c, 200)
    e12, e26 = ema(c, 12), ema(c, 26)
    macd = [None if (a is None or b is None) else a - b for a, b in zip(e12, e26)]
    macd_vals = [m for m in macd if m is not None]
    sig_tail = ema(macd_vals, 9)
    sig = [None] * (n - len(macd_vals)) + sig_tail
    r = rsi(c)
    a = atr(bars)
    per_year = 365 if symbol.endswith("-USD") else 252
    year = bars[-per_year:]
    close = c[-1]
    logret = [math.log(c[i] / c[i - 1]) for i in range(n - 20, n)]
    dvol = statistics.pstdev(logret)
    support, resistance = swing_levels(bars, close)
    hi52, lo52 = max(b["high"] for b in year), min(b["low"] for b in year)
    hi20, lo20 = max(b["high"] for b in bars[-20:]), min(b["low"] for b in bars[-20:])
    slope50 = pct(s50[-1], s50[-21]) if s50[-21] else None

    # named patterns, last 10 bars
    patterns = []
    for i in range(n - 10, n):
        if s50[i] and s200[i] and s50[i - 1] and s200[i - 1]:
            if s50[i - 1] <= s200[i - 1] < s50[i]:
                patterns.append("golden cross on %s (50-day crossed above 200-day)" % bars[i]["date"])
            if s50[i - 1] >= s200[i - 1] > s50[i]:
                patterns.append("death cross on %s (50-day crossed below 200-day)" % bars[i]["date"])
    prior_hi20 = max(b["high"] for b in bars[-21:-1]); prior_lo20 = min(b["low"] for b in bars[-21:-1])
    if close > prior_hi20:
        patterns.append("closed above the prior 20-day high (breakout)")
    if close < prior_lo20:
        patterns.append("closed below the prior 20-day low (breakdown)")
    if r[-1] is not None and r[-1] > 70:
        patterns.append("RSI over 70 (overbought zone)")
    if r[-1] is not None and r[-1] < 30:
        patterns.append("RSI under 30 (oversold zone)")
    bw = []
    for i in range(n - 126, n):
        seg = c[i - 19:i + 1]
        if s20[i]:
            bw.append(2 * statistics.pstdev(seg) / s20[i])
    if bw and bw[-1] <= min(bw) * 1.05:
        patterns.append("Bollinger bands at a six-month narrow (squeeze)")
    if hi52 and close >= hi52 * 0.98:
        patterns.append("within 2% of the 52-week high")
    if lo52 and close <= lo52 * 1.02:
        patterns.append("within 2% of the 52-week low")

    # checklist -> lean
    ret5, ret20, ret60 = pct(close, c[-6]), pct(close, c[-21]), pct(close, c[-61])
    checks = [
        ("Price above its 200-day average", close > s200[-1], "%.2f vs %.2f" % (close, s200[-1])),
        ("50-day average above the 200-day", s50[-1] > s200[-1], "%.2f vs %.2f" % (s50[-1], s200[-1])),
        ("50-day average rising over the last month", slope50 is not None and slope50 > 0, "%+.1f%%" % (slope50 or 0)),
        ("MACD above its signal line", macd[-1] > sig[-1], "%.2f vs %.2f" % (macd[-1], sig[-1])),
        ("RSI above 50", r[-1] > 50, "RSI %.0f" % r[-1]),
        ("Up over the last 20 trading days", ret20 > 0, "%+.1f%%" % ret20),
        ("Closer to the 52-week high than the low", (close - lo52) > (hi52 - close), "%.0f%% of the 52-week range" % ((close - lo52) / (hi52 - lo52) * 100 if hi52 > lo52 else 50)),
    ]
    checklist = [{"signal": s, "state": bool(ok), "vote": 1 if ok else -1, "detail": d} for s, ok, d in checks]
    score = sum(x["vote"] for x in checklist)
    lean = "bullish" if score >= 3 else "bearish" if score <= -3 else "neutral"
    trend = ("uptrend" if close > s200[-1] and s50[-1] > s200[-1] else
             "downtrend" if close < s200[-1] and s50[-1] < s200[-1] else "mixed")

    # scenarios from volatility (no drift: the honest base case)
    sig_h = dvol * math.sqrt(horizon)
    scen = {"bear_p10": close * math.exp(-1.2816 * sig_h), "inner_low": close * math.exp(-sig_h), "base": close,
            "inner_high": close * math.exp(sig_h), "bull_p90": close * math.exp(1.2816 * sig_h)}
    # target date: horizon bars ahead, approximated on the calendar
    cal = horizon if symbol.endswith("-USD") else int(round(horizon * 7 / 5))
    target = (datetime.date.fromisoformat(bars[-1]["date"]) + datetime.timedelta(days=cal)).isoformat()

    # base rate for this setup over the sample (excluding the last `horizon` bars)
    key_now = setup_key(close, s200[-1], r[-1], macd[-1], sig[-1])
    fwd = forward_returns(c, horizon)
    same, allr = [], []
    for i in range(len(fwd)):
        if s200[i] is None or r[i] is None or macd[i] is None or sig[i] is None:
            continue
        allr.append(fwd[i])
        if setup_key(c[i], s200[i], r[i], macd[i], sig[i]) == key_now:
            same.append(fwd[i])
    base_rate = {"setup": key_now, "n": len(same), "median_pct": r2(statistics.median(same) * 100) if same else None,
                 "pct_up": r2(sum(1 for x in same if x > 0) / len(same) * 100, 0) if same else None,
                 "p10_pct": r2(quantile(same, 0.1) * 100) if same else None, "p90_pct": r2(quantile(same, 0.9) * 100) if same else None,
                 "uncond_n": len(allr), "uncond_median_pct": r2(statistics.median(allr) * 100) if allr else None,
                 "uncond_pct_up": r2(sum(1 for x in allr if x > 0) / len(allr) * 100, 0) if allr else None,
                 "years": round(n / per_year, 1)}

    name = meta.get("longName") or meta.get("shortName") or symbol
    cur = meta.get("currency", "USD")
    fmt = (lambda x: "{:,.0f}".format(x)) if close >= 1000 else (lambda x: "{:,.2f}".format(x))
    words = []
    words.append("%s closed at %s on %s, %s%% from its 52-week high." % (name, fmt(close), bars[-1]["date"], r2(pct(close, hi52), 1)))
    words.append("Trend: %s, with the price %s the 200-day average and the 50-day %s over the past month." % (
        trend, "above" if close > s200[-1] else "below", "rising" if (slope50 or 0) > 0 else "falling"))
    words.append("Momentum: RSI %.0f, MACD %s its signal, %+.1f%% over 20 days." % (r[-1], "above" if macd[-1] > sig[-1] else "below", ret20))
    if support or resistance:
        words.append("Nearest levels: support %s, resistance %s." % (fmt(support) if support else "none in the last six months", fmt(resistance) if resistance else "none in the last six months"))
    if patterns:
        words.append("Patterns: " + "; ".join(patterns) + ".")
    words.append("Over the next %d trading days, ordinary volatility (%.1f%% a day) puts it between %s and %s eight times in ten." % (
        horizon, dvol * 100, fmt(scen["bear_p10"]), fmt(scen["bull_p90"])))
    if same:
        words.append("Base rate: in %s years of history, this setup (%s) came up %d times and the price was higher %d trading days later %s%% of the time, median move %+.1f%%, against %s%% for all days." % (
            base_rate["years"], key_now, len(same), horizon, base_rate["pct_up"], base_rate["median_pct"], base_rate["uncond_pct_up"]))
    words.append("Checklist %d of %d bullish: lean %s. A lean is a description of the chart, not a forecast or a recommendation." % (
        sum(1 for x in checklist if x["state"]), len(checklist), lean))

    return bars, {
        "symbol": symbol, "name": name, "currency": cur, "as_of": bars[-1]["date"], "close": r2(close, 4),
        "live_price": meta.get("regularMarketPrice"), "live_time": datetime.datetime.fromtimestamp(meta["regularMarketTime"], datetime.timezone.utc).isoformat() if meta.get("regularMarketTime") else None,
        "horizon_days": horizon, "target_date": target, "trend": {
            "label": trend, "sma20": r2(s20[-1]), "sma50": r2(s50[-1]), "sma200": r2(s200[-1]), "sma50_slope_pct": r2(slope50),
            "high_52w": r2(hi52), "low_52w": r2(lo52), "pct_from_52w_high": r2(pct(close, hi52)), "pct_from_52w_low": r2(pct(close, lo52))},
        "momentum": {"rsi14": r2(r[-1], 1), "macd": r2(macd[-1], 3), "macd_signal": r2(sig[-1], 3), "macd_hist": r2(macd[-1] - sig[-1], 3),
                     "ret_5d_pct": r2(ret5), "ret_20d_pct": r2(ret20), "ret_60d_pct": r2(ret60)},
        "volatility": {"daily_vol_pct": r2(dvol * 100), "annual_vol_pct": r2(dvol * math.sqrt(per_year) * 100, 1), "atr14": r2(a[-1]), "atr14_pct": r2(a[-1] / close * 100)},
        "levels": {"support": r2(support), "resistance": r2(resistance), "high_20d": r2(hi20), "low_20d": r2(lo20)},
        "patterns": patterns, "checklist": checklist, "score": score, "lean": lean,
        "scenarios": {k: r2(v) for k, v in scen.items()}, "base_rate": base_rate, "read": " ".join(words),
    }


def update_log(reads, bars_by_symbol):
    log = {"entries": []}
    if os.path.isfile(LOG):
        with open(LOG, encoding="utf-8") as fh:
            log = json.load(fh)
    entries = [e for e in log.get("entries", [])]
    # resolve what can be resolved
    for e in entries:
        if e.get("resolved"):
            continue
        bars = bars_by_symbol.get(e["symbol"])
        if not bars:
            continue
        hit = next((b for b in bars if b["date"] >= e["target_date"]), None)
        if hit is None:
            continue
        actual = hit["close"]
        move = actual / e["close"] - 1
        e.update({"resolved": True, "resolved_on": hit["date"], "actual_close": r2(actual, 4), "actual_pct": r2(move * 100),
                  "range_hit": e["bear_p10"] <= actual <= e["bull_p90"],
                  "direction_hit": None if e["lean"] == "neutral" else (move > 0) == (e["lean"] == "bullish")})
    # one entry per symbol per as_of date
    for rd in reads:
        entries = [e for e in entries if not (e["symbol"] == rd["symbol"] and e["made"] == rd["as_of"])]
        entries.append({"made": rd["as_of"], "symbol": rd["symbol"], "close": rd["close"], "lean": rd["lean"], "score": rd["score"],
                        "horizon_days": rd["horizon_days"], "target_date": rd["target_date"], "bear_p10": rd["scenarios"]["bear_p10"],
                        "bull_p90": rd["scenarios"]["bull_p90"], "resolved": False})
    entries.sort(key=lambda e: (e["made"], e["symbol"]))
    log["entries"] = entries
    log["note"] = "Every chart read, with its target date. Resolved entries say what actually happened. The score is this tool's own record, not a promise."
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "w", encoding="utf-8") as fh:
        json.dump(log, fh, indent=1)
    return entries


def scores(entries):
    out = {}
    for e in entries:
        s = out.setdefault(e["symbol"], {"symbol": e["symbol"], "made": 0, "resolved": 0, "range_hits": 0, "direction_calls": 0, "direction_hits": 0})
        s["made"] += 1
        if e.get("resolved"):
            s["resolved"] += 1
            s["range_hits"] += 1 if e.get("range_hit") else 0
            if e.get("direction_hit") is not None:
                s["direction_calls"] += 1
                s["direction_hits"] += 1 if e["direction_hit"] else 0
    total = {"symbol": "ALL", "made": 0, "resolved": 0, "range_hits": 0, "direction_calls": 0, "direction_hits": 0}
    for s in out.values():
        for k in ("made", "resolved", "range_hits", "direction_calls", "direction_hits"):
            total[k] += s[k]
    return list(out.values()) + [total]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Chart read from daily candles, with a base rate and a score.")
    ap.add_argument("symbols", nargs="*", help="tickers (Yahoo style: AAPL, BTC-USD); default: trader/targets.json plus BTC-USD")
    ap.add_argument("--horizon", type=int, default=20, help="trading days ahead for the range and the base rate (default 20)")
    ap.add_argument("--write", action="store_true", help="write trader/chart_read.json, the log and the raw candles")
    ap.add_argument("--json", action="store_true", help="print the JSON instead of the text")
    a = ap.parse_args(argv)
    symbols = a.symbols
    if not symbols:
        try:
            with open(os.path.join(HERE, "targets.json"), encoding="utf-8") as fh:
                symbols = [w["ticker"] for w in json.load(fh)["weights"]] + ["BTC-USD"]
        except (OSError, ValueError, KeyError):
            sys.exit("no symbols given and no trader/targets.json")
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    reads, bars_by_symbol = [], {}
    for s in symbols:
        try:
            bars, meta = fetch(s)
            bars, rd = read_symbol(s, bars, meta, a.horizon, today)
        except Exception as exc:
            print("%s: %s" % (s, exc), file=sys.stderr)
            continue
        reads.append(rd); bars_by_symbol[s] = bars
        if a.write:
            os.makedirs(RAW, exist_ok=True)
            with open(os.path.join(RAW, "candles-%s.json" % s), "w", encoding="utf-8") as fh:
                json.dump({"symbol": s, "name": rd["name"], "bars": bars}, fh)
    if not reads:
        sys.exit(1)
    result = {"as_of": today, "horizon_days": a.horizon, "reads": reads}
    if a.write:
        entries = update_log(reads, bars_by_symbol)
        result["scores"] = scores(entries)
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1)
    if a.json:
        print(json.dumps(result, indent=1))
    else:
        for rd in reads:
            print("%s (%s): %s\n  %s\n" % (rd["symbol"], rd["lean"].upper(), rd["name"], rd["read"]))
        if a.write:
            t = result["scores"][-1]
            print("Score so far: %d reads made, %d resolved, %d inside their range, %d of %d direction calls right." % (
                t["made"], t["resolved"], t["range_hits"], t["direction_hits"], t["direction_calls"]))
            print("wrote trader/chart_read.json and trader/state/chart_log.json")
    print("A chart read describes the past and quotes history. It does not know the future. Not financial advice.")


if __name__ == "__main__":
    main()
