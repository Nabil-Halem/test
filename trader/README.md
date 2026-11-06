# trader/

A paper-trading workflow built on the [trader-skill](https://github.com/Jakeschincariol/trader-skill) plugin for Claude Code. Nothing in here connects to a broker, and nothing places an order.

## The one command

```bash
python3 trader/refresh.py
```

It runs the skills in order and rebuilds the dashboard's data files:

1. **copycat** reads Berkshire Hathaway's latest 13F from SEC EDGAR and writes `targets.json` (the top 5, as weights).
2. **budget** sizes those weights to the budget in `config.json` and writes `orders.json` (proposals only).
3. **risk** checks every order against the rules and writes `state/risk.json` (PASS or BLOCK).
4. **quotes** fetches delayed prices into `prices.json`.
5. **analyst** reads each company's filed numbers from SEC and writes `metrics.json`.
6. **screener** runs the example rules in `rules.json` and writes `shortlist.json`.
7. **news** fetches a week of headlines and 8-K filings.
8. **congress** reads Nancy Pelosi's periodic transaction reports from the House Clerk.
9. **chart** writes a chart analyst's read of each stock and Bitcoin from five years of daily candles (`chart_read.py`): trend, momentum, levels, a volatility range, the base rate for the same setup, and a lean. Every read is logged and scored later against what happened.
10. It then writes the row files in `dashboard/` that the Berkshire Copycat dashboard reads.

`--data-only` skips the network and only rebuilds `dashboard/`. `--skip news congress` leaves steps out. `--cik`, `--top`, `--member` and `--hours` change what is copied and watched.

The plugin must be installed (`/plugin marketplace add Jakeschincariol/trader-skill`, then `/plugin install trader-skill@trader-skill`), and `config.json` needs your name and email as the SEC user agent.

## Then, in Claude

Say **"refresh the Berkshire Copycat dashboard"** and Claude uploads the new `dashboard/` files to the dashboard. Other things worth saying, in plain words:

- "copy Pershing Square's top 10 instead"
- "change my budget to $8,000 and the cap to 20%"
- "any news on my stocks?"
- "what did Pelosi file?"
- "is the market open?"
- "read the chart on Bitcoin"

## Files

| file | written by | what |
| --- | --- | --- |
| `config.json` | you | budget, cash buffer, cap, paper flag, SEC user agent |
| `targets.json` | copycat | the weights to copy, with the filing they came from |
| `orders.json` | budget | the proposed orders, in Alpaca's order shape |
| `state/risk.json` | risk | the verdict per order, valid for one day |
| `prices.json` | quotes | delayed quotes per ticker |
| `metrics.json`, `shortlist.json`, `rules.json` | analyst, screener | reported numbers and the example screen |
| `chart_read.json`, `state/chart_log.json` | chart_read.py | the chart reads, and the log that scores them |
| `dashboard/` | refresh.py | row files for the dashboard |
| `state/` | the skills | what has been shown or checked; mostly ignored by git |

## Fine print

Paper trading only. A 13F is up to 45 days old when filed and shows long US-listed positions only. A PASS is a rules check, not advice. Nothing here predicts prices or returns: a chart read describes the past and quotes history, and its own score says how it has done. Not financial advice.
