#!/usr/bin/env python3
"""Refresh the Berkshire Copycat workflow and the dashboard's data files.

One command runs the trader-skill scripts in order and rebuilds the row files
the dashboard reads:

    python3 trader/refresh.py              # everything (needs the network)
    python3 trader/refresh.py --data-only  # only rebuild trader/dashboard/ from what is on disk
    python3 trader/refresh.py --skip news congress   # leave some steps out

Steps: copycat (13F) -> budget -> risk -> quotes -> analyst (earnings) ->
screener -> news -> congress -> dashboard files. Each network step that fails
is reported and skipped; the dashboard files are built from whatever exists.

Paper only. Nothing here talks to a broker, and nothing is placed.
Standard library only, Python 3.8+.
"""
import argparse
import datetime
import glob
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))      # trader/
ROOT = os.path.dirname(HERE)                           # the project; the skills read trader/ from here
DASH = os.path.join(HERE, "dashboard")
RAW = os.path.join(HERE, "state", "raw")
STEPS = ["copycat", "budget", "risk", "quotes", "analyst", "screener", "news", "congress"]
ALIASES = {  # extra words that mean a company, for the news filter
    "AAPL": ["apple", "iphone"], "AXP": ["american express", "amex"], "GOOGL": ["alphabet", "google", "youtube", "waymo"],
    "GOOG": ["alphabet", "google"], "KO": ["coca-cola", "coca cola", "coke"], "BAC": ["bank of america", "bofa"],
}


def plugin_dir():
    home = os.path.expanduser("~")
    cands = [os.environ.get("TRADER_SKILL_DIR")]
    cands += sorted(glob.glob(os.path.join(home, ".claude", "plugins", "cache", "trader-skill", "trader-skill", "*")), reverse=True)
    cands += [os.path.join(home, ".claude", "plugins", "marketplaces", "trader-skill"), os.path.join(home, ".claude", "skills"),
              os.path.join(ROOT, ".claude", "skills")]
    for c in cands:
        if c and os.path.isfile(os.path.join(c, "trader-copycat", "edgar13f.py")):
            return c
    sys.exit("trader-skill plugin not found. In Claude Code: /plugin marketplace add Jakeschincariol/trader-skill "
             "then /plugin install trader-skill@trader-skill. Or set TRADER_SKILL_DIR to the plugin folder.")


def run(plugin, skill, script, *args, capture=False, ok_codes=(0,)):
    cmd = [sys.executable, os.path.join(plugin, skill, script)] + [str(a) for a in args]
    print("  $", " ".join(os.path.relpath(c, ROOT) if c.startswith(ROOT) else c for c in cmd))
    res = subprocess.run(cmd, cwd=ROOT, capture_output=capture, text=True)
    if res.returncode not in ok_codes:
        raise RuntimeError("%s exited %d%s" % (script, res.returncode, (": " + (res.stderr or res.stdout or "").strip()[:300]) if capture else ""))
    return res.stdout if capture else ""


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)


def tickers_from_targets():
    t = load(os.path.join(HERE, "targets.json")) or {}
    return [w["ticker"] for w in t.get("weights", [])]


# ------------------------------------------------------------------ the steps

def step_copycat(P, a):
    run(P, "trader-copycat", "edgar13f.py", "copy", a.cik, "--top", a.top, "--out", "trader/targets.json")
    save(os.path.join(RAW, "holdings.json"), json.loads(run(P, "trader-copycat", "edgar13f.py", "holdings", a.cik, "--combine", "--json", capture=True)))
    save(os.path.join(RAW, "diff.json"), json.loads(run(P, "trader-copycat", "edgar13f.py", "diff", a.cik, "--json", capture=True)))


def step_budget(P, a):
    run(P, "trader-budget", "size.py", "--write")


def step_risk(P, a):
    run(P, "trader-risk", "check.py", ok_codes=(0, 1))


def step_quotes(P, a):
    run(P, "trader-alerts", "alerts.py", "quote", *tickers_from_targets(), "--write")


def step_analyst(P, a):
    out = run(P, "trader-analyst", "facts.py", *tickers_from_targets(), "--metrics", "trader/metrics.json", "--json", capture=True)
    try:
        data = json.loads(out)
    except ValueError:
        data = json.loads(run(P, "trader-analyst", "facts.py", *tickers_from_targets(), "--json", capture=True))
    save(os.path.join(RAW, "analyst.json"), data)


def step_screener(P, a):
    rules = os.path.join(HERE, "rules.json")
    if not os.path.isfile(rules):
        example = os.path.join(P, "trader-screener", "rules.example.json")
        with open(example, encoding="utf-8") as src, open(rules, "w", encoding="utf-8") as dst:
            dst.write(src.read())
        print("  wrote trader/rules.json from the plugin's example rules")
    args = ["trader/metrics.json", "--rules", "trader/rules.json", "--out", "trader/shortlist.json"]
    if os.path.isfile(os.path.join(HERE, "prices.json")):
        args += ["--prices", "trader/prices.json"]
    run(P, "trader-screener", "screen.py", *args, ok_codes=(0, 1))


def step_news(P, a):
    out = run(P, "trader-news", "news.py", "--tickers", *tickers_from_targets(), "--hours", a.hours, "--json", capture=True, ok_codes=(0, 1))
    save(os.path.join(RAW, "news.json"), json.loads(out))


def step_congress(P, a):
    run(P, "trader-pelosi", "ptr.py", "new", "--member", a.member, "--read", ok_codes=(0, 1))
    listing = run(P, "trader-pelosi", "ptr.py", "index", "--member", a.member, capture=True)
    docs = re.findall(r"\bdoc (\d{6,})", listing)
    for doc in docs:
        out = run(P, "trader-pelosi", "ptr.py", "fetch", doc, "--json", capture=True)
        save(os.path.join(RAW, "ptr-%s.json" % doc), json.loads(out))
    print("  %d report(s) for %s" % (len(docs), a.member))


# ------------------------------------------------------------ dashboard files

def build_dashboard():
    T = HERE
    targets = load(os.path.join(T, "targets.json")) or {"weights": []}
    tick = [w["ticker"] for w in targets["weights"]]
    names = {w["ticker"]: w["name"] for w in targets["weights"]}
    mine = set(tick) | ({"GOOG"} if "GOOGL" in tick else set())
    written = []

    H = load(os.path.join(RAW, "holdings.json"))
    if H:
        pos = sorted(H["positions"], key=lambda p: -p["value"])
        rows = []
        for i, p in enumerate(pos, 1):
            rows.append({"rank": i, "ticker": "+".join(p.get("tickers") or [p.get("ticker") or ""]), "primary_ticker": p.get("ticker") or "",
                         "name": p.get("name") or p["issuer"].title(), "issuer": p["issuer"], "shares": p["shares"], "value_usd": p["value"],
                         "pct_of_13f": p["pct_of_13f"], "classes": len(p.get("cusips") or [1]), "ticker_guessed": bool(p.get("ticker_check")),
                         "copied": (p.get("ticker") or "") in mine})
        save(os.path.join(DASH, "holdings.json"), rows); written.append("holdings")
        m = H["meta"]; D = load(os.path.join(RAW, "diff.json")) or {"meta": {}, "changes": []}
        save(os.path.join(DASH, "filing.json"), [{"filer": m["filer"], "cik": m["cik"], "form": m["form"], "period": m["period"], "filed": m["filed"],
                                                  "accession": m["accession"], "info_table_url": m.get("info_table_url", ""), "total_value_usd": H["total"],
                                                  "positions": len(pos), "prior_period": D["meta"].get("prior_period", "")}]); written.append("filing")
        order = {"NEW": 0, "SOLD OUT": 1, "ADDED": 2, "TRIMMED": 3, "UNCHANGED": 4}
        ch = []
        for c in sorted(D["changes"], key=lambda c: (order.get(c["status"], 9), -abs(c.get("change") or 0))):
            ch.append({"status": c["status"], "cusip": c.get("cusip") or "", "ticker": c.get("ticker") or "", "issuer": c["issuer"], "title": c.get("title", ""),
                       "shares_before": c.get("shares_before"), "shares_after": c.get("shares_after"), "change_shares": c.get("change"),
                       "change_pct": c.get("change_pct"), "value_before_usd": c.get("value_before"), "value_after_usd": c.get("value_after")})
        save(os.path.join(DASH, "changes.json"), ch); written.append("changes")

    save(os.path.join(DASH, "targets.json"), [{"rank": i, "ticker": w["ticker"], "name": w["name"], "weight_pct": w["weight"], "pct_of_13f": w.get("pct_of_13f"),
                                               "value_usd": w.get("value"), "shares": w.get("shares"), "classes": "+".join(w.get("classes") or [w["ticker"]])}
                                              for i, w in enumerate(targets["weights"], 1)]); written.append("targets")

    O = load(os.path.join(T, "orders.json"))
    if O:
        rows = []
        for i, o in enumerate(O["orders"], 1):
            why = o.get("why", ""); mw = re.search(r"([\d.]+)% of the stock sleeve", why); mc = re.search(r"capped at ([\d.]+)%", why)
            rows.append({"index": i, "symbol": o["symbol"], "side": o["side"], "notional_usd": float(o["notional"]), "order_type": o["type"],
                         "time_in_force": o["time_in_force"], "weight_pct": float(mw.group(1)) if mw else None, "capped": bool(mc),
                         "cap_pct": float(mc.group(1)) if mc else None, "status": O.get("status", ""), "paper": bool(O.get("paper", True)),
                         "created_at": O.get("created_at", "")})
        save(os.path.join(DASH, "orders.json"), rows); written.append("orders")

    R = load(os.path.join(T, "state", "risk.json"))
    if R:
        save(os.path.join(DASH, "verdicts.json"), [{"index": r["index"], "symbol": r["symbol"], "side": r["side"], "value_usd": r["value_usd"],
                                                    "verdict": r["verdict"], "reasons": "; ".join(r.get("reasons") or []), "warnings": "; ".join(r.get("warnings") or []),
                                                    "fingerprint": r["fingerprint"], "date": R["date"], "checked_at": R["checked_at"], "paper": bool(R.get("paper", True))}
                                                   for r in R["results"]]); written.append("verdicts")

    C = load(os.path.join(T, "config.json")) or {}
    save(os.path.join(DASH, "rules.json"), [{"budget_usd": C.get("budget"), "cash_buffer_pct": C.get("cash_buffer_pct", 10), "max_position_pct": C.get("max_position_pct", 25),
                                             "paper": bool(C.get("paper", True)), "max_order_usd": C.get("max_order_usd", 2000), "min_order_usd": C.get("min_order_usd", 5),
                                             "max_orders_per_day": C.get("max_orders_per_day", 10)}]); written.append("rules")

    Pq = load(os.path.join(T, "prices.json"))
    if Pq:
        rows = []
        for t in tick:
            px = Pq["prices"].get(t); det = (Pq.get("detail") or {}).get(t, {}); prev = det.get("prev_close")
            rows.append({"ticker": t, "price_usd": px, "prev_close_usd": prev, "change_pct": round((px - prev) / prev * 100, 2) if px and prev else None,
                         "quoted_at": det.get("time", ""), "source": det.get("source", Pq.get("source", "")), "as_of": Pq.get("as_of", "")})
        save(os.path.join(DASH, "quotes.json"), rows); written.append("quotes")

    A = load(os.path.join(RAW, "analyst.json")); M = load(os.path.join(T, "metrics.json")) or {"companies": []}
    if A:
        quarters, earnings = [], []
        for c in sorted(A, key=lambda c: tick.index(c["ticker"]) if c["ticker"] in tick else 99):
            t = c["ticker"]; r = c["result"]; f = c.get("filings") or {}; rows = r.get("rows") or []
            for i, q in enumerate(rows):
                quarters.append({"ticker": t, "key": t + "-" + q["end"], "quarter_end": q["end"], "fiscal": q.get("fiscal", ""), "revenue_usd": q.get("revenue"),
                                 "net_income_usd": q.get("net_income"), "eps_diluted": q.get("eps_diluted"), "gross_margin": q.get("gross_margin"),
                                 "operating_margin": q.get("operating_margin"), "net_margin": q.get("net_margin"), "revenue_yoy": q.get("revenue_yoy"),
                                 "eps_yoy": q.get("eps_yoy"), "derived": bool(q.get("derived")), "latest": i == 0})
            latest = rows[0] if rows else {}; rep = f.get("report") or {}; ek = f.get("earnings_8k") or {}
            mrow = next((m for m in M["companies"] if m["ticker"] == t), {})
            earnings.append({"ticker": t, "name": r.get("entity", t), "quarter_end": latest.get("end", ""), "fiscal": latest.get("fiscal", ""), "derived": bool(latest.get("derived")),
                             "revenue_usd": latest.get("revenue"), "revenue_yoy": latest.get("revenue_yoy"), "net_income_usd": latest.get("net_income"),
                             "net_income_yoy": latest.get("net_income_yoy"), "eps_diluted": latest.get("eps_diluted"), "eps_yoy": latest.get("eps_yoy"),
                             "net_margin": latest.get("net_margin"), "operating_margin": latest.get("operating_margin"), "gross_margin": latest.get("gross_margin"),
                             "revenue_ttm_usd": mrow.get("revenue_ttm"), "eps_ttm": mrow.get("eps_ttm"), "report_form": rep.get("form", ""), "report_filed": rep.get("filed", ""),
                             "report_url": rep.get("url", ""), "earnings_8k_filed": ek.get("filed", ""), "earnings_8k_url": ek.get("url", ""),
                             "press_release_url": (ek.get("exhibit").get("url", "") if isinstance(ek.get("exhibit"), dict) else (ek.get("exhibit") or "")),
                             "summary": (c.get("changes") or [""])[0], "note": c.get("note") or ""})
        save(os.path.join(DASH, "earnings.json"), earnings); save(os.path.join(DASH, "quarters.json"), quarters); written += ["earnings", "quarters"]

    SL = load(os.path.join(T, "shortlist.json"))
    if SL:
        mnames = {m["ticker"]: m["name"] for m in M["companies"]}
        rows = [{"ticker": p["ticker"], "name": p.get("name") or mnames.get(p["ticker"], ""), "result": "PASS", "score": p.get("score"), "why": "; ".join(p.get("why") or [])} for p in SL.get("passed", [])]
        rows += [{"ticker": f["ticker"], "name": mnames.get(f["ticker"], ""), "result": "FAIL", "score": None, "why": "; ".join(f.get("why") or [])} for f in SL.get("failed", [])]
        rules = "; ".join("%s %s %s" % (r["metric"], r["op"], r["value"]) for r in SL.get("rules", []))
        for r in rows:
            r.update({"screen": SL.get("name", ""), "rules": rules, "prices_as_of": SL.get("prices_as_of", "")})
        rows.sort(key=lambda r: (0 if r["result"] == "PASS" else 1, -(r["score"] or 0), tick.index(r["ticker"]) if r["ticker"] in tick else 99))
        save(os.path.join(DASH, "shortlist.json"), rows); written.append("shortlist")

    N = load(os.path.join(RAW, "news.json"))
    if N:
        rows, per = [], {}
        for it in sorted(N.get("items", []), key=lambda i: i.get("time", ""), reverse=True):
            t = it.get("ticker", ""); text = " " + (it.get("title", "") + " " + (it.get("summary") or "")).lower() + " "
            words = [t.lower(), (names.get(t) or "").lower()] + ALIASES.get(t, [])
            named = it.get("kind") == "filing" or any(w and w in text for w in words)
            if not named:
                continue
            if it.get("kind") != "filing":
                if per.get(t, 0) >= 6:
                    continue
                per[t] = per.get(t, 0) + 1
            rows.append({"time": it.get("time", ""), "ticker": t, "kind": it.get("kind", ""), "important": bool(it.get("important")), "title": it.get("title", ""),
                         "summary": (it.get("summary") or "")[:240], "link": it.get("link", ""), "source": it.get("source", ""), "tags": ", ".join(it.get("tags") or []),
                         "touches": ", ".join(it.get("touches") or []), "form": it.get("form", ""), "names_company": True, "id": it.get("id", "")})
        save(os.path.join(DASH, "news.json"), rows); written.append("news")

    ptrs = sorted(glob.glob(os.path.join(RAW, "ptr-*.json")))
    if ptrs:
        rows = []
        for p in ptrs:
            d = load(p) or {}
            for i, r in enumerate(d.get("rows") or []):
                opt = r.get("option") or {}
                if r.get("asset_type") == "OP" or (opt and not opt.get("exercised")):
                    detail = "%s %s options, $%s strike, expires %s" % (opt.get("contracts", ""), opt.get("kind", "option"), opt.get("strike", ""), opt.get("expires", ""))
                    kind = "call options" if opt.get("kind") == "call" else "options"
                elif opt and opt.get("exercised"):
                    detail = "shares, from exercising %s %s options at $%s" % (opt.get("contracts", ""), opt.get("kind", ""), opt.get("strike", "")); kind = "shares (exercised options)"
                elif r.get("asset_type") == "ST":
                    detail = ("%s shares" % format(int(r["shares"]), ",")) if r.get("shares") else "shares"; kind = "shares"
                else:
                    detail = "other (not a listed stock)"; kind = "other"
                rows.append({"key": "%s-%d" % (d.get("doc_id", "?"), i + 1), "doc_id": d.get("doc_id", ""), "filed": d.get("filed", ""), "member": d.get("name", ""),
                             "district": d.get("district", ""), "owner": r.get("owner_name") or r.get("owner") or "member", "action": r.get("type_name") or r.get("type", ""),
                             "asset": r.get("asset", ""), "ticker": r.get("ticker") or "", "kind": kind, "detail": detail, "amount": r.get("amount", ""),
                             "amount_low": r.get("amount_low"), "amount_high": r.get("amount_high"), "traded": r.get("date", ""), "days_to_disclose": r.get("days_to_disclose"),
                             "late": bool(r.get("late")), "in_portfolio": (r.get("ticker") or "") in mine, "description": r.get("description", ""), "url": d.get("url", "")})
        rows.sort(key=lambda r: (r["filed"], r["traded"]), reverse=True)
        save(os.path.join(DASH, "congress.json"), rows); written.append("congress")

    save(os.path.join(DASH, "manifest.json"), {"written_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                                               "files": written, "note": "Row files for the Berkshire Copycat dashboard. Ask Claude to refresh the dashboard and it uploads these."})
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cik", default="1067983", help="the 13F filer to copy (default Berkshire Hathaway)")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--member", default="pelosi", help="the member of Congress to track")
    ap.add_argument("--hours", type=int, default=168, help="how far back the news check looks")
    ap.add_argument("--skip", nargs="*", default=[], choices=STEPS, help="steps to leave out")
    ap.add_argument("--data-only", action="store_true", help="only rebuild trader/dashboard/ from the files already on disk")
    a = ap.parse_args(argv)
    if not a.data_only:
        P = plugin_dir()
        print("plugin:", P)
        for step in STEPS:
            if step in a.skip:
                print("skip  ", step); continue
            print("step  ", step)
            try:
                globals()["step_" + step](P, a)
            except Exception as exc:  # a failed network step must not stop the rest
                print("  skipped: %s" % exc)
    written = build_dashboard()
    print("dashboard files in trader/dashboard/: " + ", ".join(written))
    print("Paper only. Nothing was placed. Next: ask Claude to refresh the Berkshire Copycat dashboard.")


if __name__ == "__main__":
    main()
