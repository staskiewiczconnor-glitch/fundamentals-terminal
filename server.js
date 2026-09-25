// Ticker -> 6 fundamentals charts. Data source: stockanalysis.com's quarterly
// financial-statement pages (free, no key, robots.txt-permitted for /stocks/ paths).
// Scraped server-side (the source page has no CORS headers, so a static page can't
// fetch it directly) and cached in memory so repeat requests for the same ticker
// within the TTL don't re-hit the source.
const express = require('express');
const path = require('path');
const { scrapeTicker } = require('./scrape');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ---------- tiny in-memory cache ----------
const cache = new Map(); // key -> { at, ttl, data }
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key);
    return undefined;
  }
  return hit.data;
}
function cacheSet(key, data, ttl) {
  cache.set(key, { at: Date.now(), ttl, data });
}

const HOUR = 3600 * 1000;

function pctChange(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

async function buildResponse(ticker, years) {
  const key = `sa:${ticker.toUpperCase()}`;
  let scraped = cacheGet(key);
  if (!scraped) {
    scraped = await scrapeTicker(ticker);
    cacheSet(key, scraped, 6 * HOUR);
  }

  // Quarters come back oldest -> newest; keep roughly the last `years` worth (4/yr).
  const quarters = scraped.quarters.slice(-Math.max(years, 1) * 4);

  const latest = quarters[quarters.length - 1] || null;
  const prevYear = quarters[quarters.length - 5] || null; // 4 quarters back

  return {
    ticker: scraped.ticker,
    name: scraped.name,
    source: 'stockanalysis.com',
    quarters,
    summary: latest && {
      asOf: latest.end,
      revenueTTM: { value: latest.revenueTTM, yoyPct: pctChange(latest.revenueTTM, prevYear && prevYear.revenueTTM) },
      fcfTTM: { value: latest.fcfTTM, yoyPct: pctChange(latest.fcfTTM, prevYear && prevYear.fcfTTM) },
      debtEquity: { value: latest.debtEquity, yoyPct: pctChange(latest.debtEquity, prevYear && prevYear.debtEquity) },
      peRatio: { value: latest.peRatio, yoyPct: pctChange(latest.peRatio, prevYear && prevYear.peRatio) },
      roeTTM: { value: latest.roeTTM, yoyPct: pctChange(latest.roeTTM, prevYear && prevYear.roeTTM) },
      sharesOutstanding: {
        value: latest.sharesOutstanding,
        yoyPct: pctChange(latest.sharesOutstanding, prevYear && prevYear.sharesOutstanding),
      },
    },
  };
}

app.get('/api/fundamentals/:ticker', async (req, res) => {
  const years = Math.min(Math.max(parseInt(req.query.years, 10) || 5, 1), 15);
  try {
    const data = await buildResponse(req.params.ticker, years);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`ticker-fundamentals listening on http://localhost:${PORT}`));
