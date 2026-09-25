# Fundamentals Terminal

Type a ticker, get 6 charts: **Revenue (TTM)**, **Free Cash Flow (TTM)**, **Debt/Equity**,
**P/E (at quarter end)**, **ROE (TTM)**, and **Shares Outstanding**. Dark terminal UI.
Free forever, no API keys, no purchased plan, no rate-limit ceiling beyond ordinary
fair use.

## Where the data comes from

The server scrapes two of [stockanalysis.com](https://stockanalysis.com)'s quarterly
financial-statement pages per ticker:

- `/stocks/{TICKER}/financials/income-statement/?p=quarterly` — Revenue, Free Cash
  Flow, Shares Outstanding (Diluted)
- `/stocks/{TICKER}/financials/ratios/?p=quarterly` — P/E Ratio, Debt/Equity Ratio,
  Return on Equity

Their `robots.txt` explicitly allows crawling `/stocks/` paths for general clients
(it only blocks a handful of named scraper bots and its own `/e/` and `/p/`
analytics/internal paths) — this app stays well inside that. Neither page sets CORS
headers, so a browser can't fetch them directly from a static page; the server does
the fetching and parses the returned HTML tables server-side, which is also why a
Claude Artifact can't do this part on its own.

Revenue and Free Cash Flow are reported per-quarter on the source site; the server
rolls each into a trailing-twelve-month figure (last 4 quarters summed) before
charting. Debt/Equity, P/E, and ROE are already point-in-time ratios as of each
quarter end, so those are used as-is. Shares Outstanding is the source site's own
diluted-share figure, reported to the nearest thousand shares.

Every request re-scrapes the live pages (results are cached for 6 hours per
ticker just to avoid hammering the source on repeat clicks), so a new quarterly
report shows up here automatically the next time you look up that ticker after
stockanalysis.com has it — no redeploy, no manual refresh needed.

## Deploy it for free — Render, ~5 minutes, no credit card

1. Push this folder to a new **GitHub repo** (drag-and-drop into a new repo on
   github.com if you don't already use git from the command line).
2. Go to **render.com** → sign up free → **New +** → **Web Service** → connect
   that repo.
3. Render should auto-detect Node. If asked:
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
4. Click **Create Web Service**. In ~2 minutes you get a permanent URL like
   `https://fundamentals-terminal.onrender.com` — that's your one link, live and
   unlimited, from then on. No environment variables needed.

The included `render.yaml` lets you do this as one "Blueprint" deploy instead of
filling in the fields by hand: New + → **Blueprint** → point it at the repo.

Free-tier Render spins the service down after 15 minutes of no traffic and takes
~30–50 seconds to wake back up on the next request — normal for a personal tool,
not something to fix unless it bothers you (a paid Render tier keeps it warm).

## Run it locally first (optional, to see it work before deploying)

```bash
npm install
npm start
```

Open **http://localhost:3000**.

## Known limitations

- The site's fiscal-quarter labels ("Q1 2024") follow each company's own fiscal
  calendar, not the calendar year — that's shown as the chart's x-axis label
  directly rather than converted to a calendar date, since the mapping between
  the two is company-specific.
- This is derived/scraped data for your own dashboarding, not a substitute for
  reading the actual filing on anything decision-critical.
- Scraping is for ordinary interactive use (people typing tickers into the page)
  — don't point a script at this to loop over hundreds of tickers back-to-back.

## Files

- `server.js` — Express app: routes, caching.
- `scrape.js` — fetches and parses the stockanalysis.com pages into quarterly series
  (no I/O in the parsing functions themselves — see `scrape.fixture.test.js`).
- `scrape.fixture.test.js` — sanity checks for `scrape.js`'s parsing logic against a
  fixture built from real captured page markup (no network needed).
- `public/index.html` — the whole frontend (Chart.js via CDN, vanilla JS, no build step).
- `render.yaml` — optional one-click Render Blueprint config.
