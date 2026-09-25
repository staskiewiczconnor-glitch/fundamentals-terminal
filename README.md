# Fundamentals Terminal

Type a ticker, get the same 6 charts as the cmlviz screenshots: **Revenue (TTM)**,
**Free Cash Flow (TTM)**, **Debt/Equity**, **P/E (at quarter end)**,
**ROE (TTM)**, and **Shares Outstanding**. Dark terminal UI. Free forever, no API
keys, no purchased plan, no rate-limit ceiling beyond SEC's own fair-use ask.

## Why this needs a tiny server (not just a static HTML file)

The data comes from two free, keyless sources — SEC EDGAR's XBRL company-facts API
and Stooq's daily price CSVs. Neither sets CORS headers, so a browser can't call
them directly from a static page (this is also why a Claude Artifact can't do this
part on its own). The server proxies both and does the math; the browser just
renders charts. That's the whole trade: one small always-on process instead of
zero setup.

## Deploy it for free — Render, ~5 minutes, no credit card

1. Unzip this folder and push it to a new **GitHub repo** (Render deploys from a
   repo; drag-and-drop the folder into a new repo on github.com if you don't
   already use git from the command line).
2. Go to **render.com** → sign up free → **New +** → **Web Service** → connect
   that repo.
3. Render should auto-detect Node. If asked:
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
4. Under **Environment**, add one variable:
   - `SEC_USER_AGENT` = `Your Name your@email.com` (see below for why)
5. Click **Create Web Service**. In ~2 minutes you get a permanent URL like
   `https://fundamentals-terminal.onrender.com` — that's your one link, live and
   unlimited, from then on.

The included `render.yaml` lets you do this as one "Blueprint" deploy instead of
filling in the fields by hand, if you prefer: New + → **Blueprint** → point it at
the repo → Render reads `render.yaml` and sets everything up itself (still asks
you to fill in `SEC_USER_AGENT` since that's marked secret).

Free-tier Render spins the service down after 15 minutes of no traffic and takes
~30–50 seconds to wake back up on the next request — normal for a personal tool,
not something to fix unless it bothers you (a paid Render tier keeps it warm).

Railway and Fly.io both also have free/hobby tiers and work the same way (Node
app, `npm start`, set `SEC_USER_AGENT`) if you'd rather use one of those.

## Run it locally first (optional, to see it work before deploying)

```bash
npm install
SEC_USER_AGENT="Your Name your@email.com" npm start
```

Open **http://localhost:3000**. `SEC_USER_AGENT` isn't optional in spirit — SEC
asks every automated client to identify itself (see their [developer FAQ](https://www.sec.gov/os/webmaster-faq#developers)).
It'll run without it (falls back to a placeholder), but set it to avoid getting
your IP rate-limited.

## How the numbers are derived

- **CIK lookup**: `sec.gov/files/company_tickers.json` (ticker → CIK), cached 24h.
- **Financial-statement data**: `data.sec.gov/api/xbrl/companyfacts/CIK##########.json`
  — the raw XBRL facts every 10-Q/10-K tags. Cached 12h per ticker.
- **Price**: `stooq.com` daily close CSV, matched to each fiscal quarter-end date.
  Cached 6h per ticker. If Stooq has no data for a ticker (delisted, non-US,
  thinly covered), every other chart still renders — P/E just comes back empty.

Quarterly figures aren't reported as clean discrete numbers in XBRL — cash-flow
items in particular are tagged as *year-to-date cumulative* (a 10-Q's "9 months
ended" column, not "3 months ended"). `xbrl.js` derives discrete quarters by
grouping facts on their XBRL context start date and diffing successive periods,
which works whether a filer tags cumulative or already-discrete values. Run
`node xbrl.test.js` to see it verified against synthetic fixtures (no network
needed) — that's also the fastest way to sanity-check the logic if you tweak it.

From there:
- **Revenue TTM / FCF TTM** = rolling sum of the last 4 discrete quarters
  (FCF = operating cash flow − capex, per quarter, then summed).
- **Debt/Equity** = total debt ÷ stockholders' equity, both as of the quarter-end  balance sheet date. "Total debt" tries `LongTermDebt`, then
  `LongTermDebtNoncurrent + LongTermDebtCurrent + ShortTermBorrowings`, and only
  falls back to total `Liabilities` if a filer tags no debt concept at all — check
  `tags.debtIsFallbackLiabilities` in the API response if a D/E number looks off.
-  **ROE (TTM)** = TTM net income ÷ stockholders' equity at that quarter end.
- **P/E (at quarter end)** = (price × shares outstanding) ÷ TTM net income,
  i.e. market cap ÷ TTM earnings — avoids needing a separate EPS/share-count-
  weighting derivation.
- **Shares Outstanding** = `dei:EntityCommonStockSharesOutstanding` (the cover-page
  figure filers report each quarter), falling back to
  `us-gaap:CommonStockSharesOutstanding` if the former isn't tagged.

## Known limitations

- **US SEC filers only.** Foreign private issuers filing 20-F (annual only, no
  10-Q) won't have quarterly data.
- **Recent IPOs** will have fewer quarters than the selected lookback window —
  the UI just shows what's on file.
- XBRL tagging isn't perfectly uniform across companies; the tag actually used
  for each metric is returned in the API response's `tags` object if you want to
  audit a specific ticker.
- This is derived data for your own dashboarding, not a substitute for reading
  the actual filing on anything decision-critical.
- SEC and Stooq have no formal request quota, but hammering them (e.g. scripted
  loops over hundreds of tickers back-to-back) is the kind of thing that gets an
  IP throttled — normal interactive use (people typing tickers into the page)
  is exactly what "fair use" covers.

## Files

- `server.js` — Express app: routes, caching, SEC/Stooq fetching, quarter alignment.
- `xbrl.js` — pure functions that turn raw XBRL facts into quarterly series (no I/O).
- `xbrl.test.js` — sanity checks for `xbrl.js` against synthetic fixtures.
- `public/index.html` — the whole frontend (Chart.js via CDN, vanilla JS, no build step).
- `render.yaml` — optional one-click Render Blueprint config.
